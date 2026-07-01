import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DesignAdjustmentCategory, ReviewCommentInput } from "../../db/design-review-db.js";
import { openDesignReviewDb } from "../../db/design-review-db.js";
import { mapCommentsToDesignNodes } from "../../planning/design-comments.js";
import { readDesignNodeMap } from "../../planning/design-node-map.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import type { FigmaComment } from "../../sync/figma-types.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { findMatchingGraphReviewArtifact, graphReviewArtifactDetail } from "./review-artifacts.js";

export interface FigmaCommentsClient {
  getComments(fileKey: string, opts?: { asMarkdown?: boolean }): Promise<FigmaComment[]>;
  postComment?(
    fileKey: string,
    input: { message: string; commentId?: string }
  ): Promise<FigmaComment>;
}

export interface RegisterDesignCommentToolsOpts {
  figmaClientFactory?: (token: string) => FigmaCommentsClient;
}

const ReviewCommentsInputSchema = z.object({
  scope: z.string().optional(),
  screen: z.string().optional(),
  fileKey: z.string().optional(),
  includeResolved: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(200).optional().default(25),
});

type ReviewCommentsInput = z.infer<typeof ReviewCommentsInputSchema>;

const DesignAdjustmentCategorySchema = z.enum([
  "spacing",
  "density",
  "typography",
  "hierarchy",
  "color",
  "component",
  "interaction",
  "copy",
  "responsive",
  "layout",
  "other",
]);

const AdjustmentRecordInputSchema = z.object({
  sessionId: z.string().optional(),
  scope: z.string().optional(),
  screen: z.string().optional(),
  fileKey: z.string().optional(),
  commentId: z.string().optional(),
  nodeId: z.string().optional(),
  category: DesignAdjustmentCategorySchema,
  summary: z.string().min(1),
  preferenceKey: z.string().optional(),
  preferenceSummary: z.string().optional(),
});

const ReviewReportInputSchema = z.object({
  sessionId: z.string().optional(),
  scope: z.string().optional(),
  screen: z.string().optional(),
  limit: z.number().int().positive().max(200).optional().default(25),
});

const ReplyPrepareInputSchema = z.object({
  sessionId: z.string().optional(),
  fileKey: z.string().optional(),
  commentIds: z.array(z.string()).optional(),
  message: z.string().min(1).default("Fixed in this pass."),
});

const ReplyPostInputSchema = z.object({
  sessionId: z.string().optional(),
  fileKey: z.string().optional(),
  outboxIds: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional().default(10),
  confirm: z.literal(true),
});

const MemoryCandidatesInputSchema = z.object({
  status: z.enum(["candidate", "promoted", "dismissed"]).optional(),
  limit: z.number().int().positive().max(100).optional().default(25),
});

const MemoryPromoteInputSchema = z.object({
  candidateKey: z.string().min(1),
  scope: z.string().optional(),
  rule: z.string().optional(),
});

const MemoryDismissInputSchema = z.object({
  candidateKey: z.string().min(1),
});

const MemoryUpdateInputSchema = z.object({
  preferenceKey: z.string().min(1),
  rule: z.string().optional(),
  scope: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const MemorySearchInputSchema = z.object({
  scope: z.string().optional(),
  category: DesignAdjustmentCategorySchema.optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).optional().default(25),
});

const sliceComments = <T>(items: T[], limit: number): T[] => items.slice(0, limit);

const resolveNodeMap = async (root: string, input: ReviewCommentsInput) => {
  if (input.scope === undefined) return null;
  return readDesignNodeMap(root, input.scope, input.screen ?? null);
};

const authorFromComment = (comment: FigmaComment): string | undefined =>
  comment.user?.handle ?? comment.user?.email ?? comment.user?.id;

const commentTargetById = (comments: ReturnType<typeof mapCommentsToDesignNodes>) =>
  new Map(
    comments.mapped.flatMap((comment) =>
      comment.target === undefined ? [] : ([[comment.id, comment.target]] as const)
    )
  );

const reviewCommentInputs = (
  comments: FigmaComment[],
  mappedAll: ReturnType<typeof mapCommentsToDesignNodes>,
  input: { fileKey: string }
): ReviewCommentInput[] => {
  const targets = commentTargetById(mappedAll);
  return comments.map((comment) => {
    const target = targets.get(comment.id);
    const nodeId = comment.client_meta?.node_id ?? target?.nodeId;
    const resolvedAt = comment.resolved_at ?? undefined;
    const status = resolvedAt ? "already-resolved" : target !== undefined ? "open" : "unmapped";
    return {
      commentId: comment.id,
      fileKey: input.fileKey,
      ...(comment.parent_id !== undefined ? { parentId: comment.parent_id } : {}),
      message: comment.message ?? "",
      ...(authorFromComment(comment) !== undefined ? { author: authorFromComment(comment) } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      status,
      ...(comment.created_at !== undefined ? { createdAt: comment.created_at } : {}),
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
      ...(target !== undefined ? { target } : {}),
    };
  });
};

const graphCommentSnapshot = (comments: ReviewCommentInput[]): Record<string, unknown>[] =>
  comments.map((comment) => ({
    commentId: comment.commentId,
    message: comment.message,
    ...(comment.nodeId !== undefined ? { nodeId: comment.nodeId } : {}),
    ...(typeof comment.target === "object" &&
    comment.target !== null &&
    "nodeName" in comment.target &&
    typeof comment.target.nodeName === "string"
      ? { targetName: comment.target.nodeName }
      : {}),
  }));

const registerTool = (
  registry: ToolRegistry,
  tool: Tool,
  handler: (args: unknown) => Promise<ReturnType<typeof toolText> | ReturnType<typeof toolError>>
): void => {
  registry.tools.push(tool);
  registry.handlers.set(tool.name, handler);
};

const requireFigmaClient = async (
  ctx: ToolContext,
  opts: RegisterDesignCommentToolsOpts
): Promise<FigmaCommentsClient | ReturnType<typeof toolError>> => {
  const config = await ctx.loadConfig();
  const token = await resolveFigmaToken(ctx.root, config);
  if (token === undefined || token === "") {
    return toolError(
      new KotikitError(
        "I couldn't find your Figma token.",
        "Create a .env file in your project root with FIGMA_TOKEN=figd_... or set figma.token in .kotikit/config.json. Reading comments requires file_comments:read; posting replies requires file_comments:write."
      )
    );
  }
  return opts.figmaClientFactory ? opts.figmaClientFactory(token) : new FigmaClient({ token });
};

export function registerDesignCommentTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterDesignCommentToolsOpts = {}
): void {
  const tool: Tool = {
    name: "kotikit_design_review_comments",
    description:
      "Fetch Figma review comments and map them to kotikit-applied design nodes when a local node map exists.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope slug whose design node map should be used." },
        screen: { type: "string", description: "Screen slug; omit for single-screen specs." },
        fileKey: {
          type: "string",
          description: "Figma file key. Optional when a node map has figmaFileKey.",
        },
        includeResolved: {
          type: "boolean",
          description: "Include resolved comments. Defaults to false.",
        },
        limit: {
          type: "number",
          description:
            "Maximum mapped and unmapped comments returned per bucket. Defaults to 25, max 200.",
        },
      },
    },
  };

  registerTool(registry, tool, async (args) => {
    try {
      const input = ReviewCommentsInputSchema.parse(args);
      const clientOrError = await requireFigmaClient(ctx, opts);
      if ("isError" in clientOrError) return clientOrError;

      const nodeMap = await resolveNodeMap(ctx.root, input);
      const fileKey = input.fileKey ?? nodeMap?.figmaFileKey;
      if (fileKey === undefined || fileKey === "") {
        return toolError(
          new KotikitError(
            "I don't know which Figma file to read comments from.",
            "Pass fileKey, or apply the design from the Figma plugin first so kotikit can write a design.node-map.json with figmaFileKey."
          )
        );
      }

      const comments = await clientOrError.getComments(fileKey, { asMarkdown: true });
      const mapped = mapCommentsToDesignNodes(comments, nodeMap, {
        includeResolved: input.includeResolved,
      });
      const mappedAll = mapCommentsToDesignNodes(comments, nodeMap, {
        includeResolved: true,
      });
      const reviewableComments = comments.filter(
        (comment) => input.includeResolved || !comment.resolved_at
      );
      const commentRows = reviewCommentInputs(reviewableComments, mappedAll, { fileKey });
      const store = openDesignReviewDb(ctx.root);
      const session = store.recordReviewSession({
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.screen !== undefined ? { screen: input.screen } : {}),
        fileKey,
        totalFetched: comments.length,
        mappedCount: mapped.mapped.length,
        unmappedCount: mapped.unmapped.length,
        skippedResolved: mapped.skippedResolved,
        comments: commentRows,
      });
      const detail = {
        sessionId: session.sessionId,
        fileKey,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.screen !== undefined ? { screen: input.screen } : {}),
        hasNodeMap: nodeMap !== null,
        totalFetched: comments.length,
        skippedResolved: mapped.skippedResolved,
        mapped: sliceComments(mapped.mapped, input.limit),
        unmapped: sliceComments(mapped.unmapped, input.limit),
        truncated: {
          mapped: Math.max(0, mapped.mapped.length - input.limit),
          unmapped: Math.max(0, mapped.unmapped.length - input.limit),
        },
        graphFacade: {
          preferredTool: "kotikit_start",
          flowId: "review-comments",
          input: {
            review: {
              commentSnapshot: {
                comments: graphCommentSnapshot(commentRows),
              },
            },
          },
        },
      };

      return toolText(
        `Fetched ${comments.length} Figma comment(s): ${mapped.mapped.length} mapped, ${mapped.unmapped.length} unmapped.`,
        detail
      );
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(
    registry,
    {
      name: "kotikit_design_adjustment_record",
      description: "Record a compact design adjustment made in response to review feedback.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          scope: { type: "string" },
          screen: { type: "string" },
          fileKey: { type: "string" },
          commentId: { type: "string" },
          nodeId: { type: "string" },
          category: { type: "string", enum: DesignAdjustmentCategorySchema.options },
          summary: { type: "string" },
          preferenceKey: { type: "string" },
          preferenceSummary: { type: "string" },
        },
        required: ["category", "summary"],
      },
    },
    async (args) => {
      try {
        const input = AdjustmentRecordInputSchema.parse(args);
        const store = openDesignReviewDb(ctx.root);
        const adjustment = store.recordDesignAdjustment({
          ...input,
          category: input.category as DesignAdjustmentCategory,
        });
        return toolText("Recorded design adjustment.", { adjustment });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_review_report",
      description: "Return a compact report for the latest or selected design review session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          scope: { type: "string" },
          screen: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    async (args) => {
      try {
        const input = ReviewReportInputSchema.parse(args);
        const graphArtifact = await findMatchingGraphReviewArtifact(ctx.root, input);
        if (graphArtifact !== null) {
          return toolText("Graph review artifact.", graphReviewArtifactDetail(graphArtifact));
        }
        const report = openDesignReviewDb(ctx.root).getReviewReport(input);
        return toolText("Design review report.", report);
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_comment_reply_prepare",
      description:
        "Prepare pending Figma comment replies for fixed review comments without posting them.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          fileKey: { type: "string" },
          commentIds: { type: "array", items: { type: "string" } },
          message: { type: "string" },
        },
      },
    },
    async (args) => {
      try {
        const input = ReplyPrepareInputSchema.parse(args);
        const replies = openDesignReviewDb(ctx.root).prepareCommentReplies(input);
        return toolText(
          `Prepared ${replies.length} pending Figma repl${replies.length === 1 ? "y" : "ies"}.`,
          { replies }
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_comment_reply_post",
      description: "Post pending prepared Figma comment replies. Requires file_comments:write.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          fileKey: { type: "string" },
          outboxIds: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
          confirm: {
            type: "boolean",
            description: "Must be true after the user approves posting replies.",
          },
        },
        required: ["confirm"],
      },
    },
    async (args) => {
      try {
        const parsed = ReplyPostInputSchema.safeParse(args);
        if (!parsed.success) {
          throw new KotikitError(
            "I need explicit confirmation before posting Figma comment replies.",
            "Ask the designer if they want these replies posted, then call this tool with confirm: true."
          );
        }
        const input = parsed.data;
        const store = openDesignReviewDb(ctx.root);
        const pending = store
          .listPendingReplies({
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(input.fileKey !== undefined ? { fileKey: input.fileKey } : {}),
            limit: input.limit,
          })
          .filter(
            (reply) => input.outboxIds === undefined || input.outboxIds.includes(reply.outboxId)
          );
        const clientOrError = await requireFigmaClient(ctx, opts);
        if ("isError" in clientOrError) return clientOrError;
        if (!clientOrError.postComment) {
          throw new KotikitError(
            "This Figma client cannot post comments.",
            "Use the real Figma client or a test client with postComment."
          );
        }

        const posted = [];
        const failed = [];
        for (const reply of pending) {
          try {
            const figmaReply = await clientOrError.postComment(reply.fileKey, {
              message: reply.message,
              commentId: reply.commentId,
            });
            store.markReplyPosted({
              outboxId: reply.outboxId,
              postedCommentId: figmaReply.id,
            });
            posted.push({
              outboxId: reply.outboxId,
              commentId: reply.commentId,
              postedCommentId: figmaReply.id,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            store.markReplyFailed({ outboxId: reply.outboxId, error: message });
            failed.push({ outboxId: reply.outboxId, commentId: reply.commentId, error: message });
          }
        }

        return toolText(`Posted ${posted.length} Figma repl${posted.length === 1 ? "y" : "ies"}.`, {
          posted,
          failed,
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_memory_candidates",
      description:
        "List repeated design feedback patterns that may become project design preferences.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["candidate", "promoted", "dismissed"] },
          limit: { type: "number" },
        },
      },
    },
    async (args) => {
      try {
        const input = MemoryCandidatesInputSchema.parse(args);
        const candidates = openDesignReviewDb(ctx.root).listPreferenceCandidates(input);
        return toolText(`Found ${candidates.length} design memory candidate(s).`, { candidates });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_memory_promote",
      description:
        "Promote a repeated feedback candidate into an active project design preference.",
      inputSchema: {
        type: "object",
        properties: {
          candidateKey: { type: "string" },
          scope: { type: "string" },
          rule: { type: "string" },
        },
        required: ["candidateKey"],
      },
    },
    async (args) => {
      try {
        const input = MemoryPromoteInputSchema.parse(args);
        const preference = openDesignReviewDb(ctx.root).promotePreferenceCandidate({
          key: input.candidateKey,
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          ...(input.rule !== undefined ? { rule: input.rule } : {}),
        });
        return toolText("Promoted design preference.", { preference });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_memory_dismiss",
      description:
        "Dismiss a repeated feedback candidate that should not become a project design preference.",
      inputSchema: {
        type: "object",
        properties: {
          candidateKey: { type: "string" },
        },
        required: ["candidateKey"],
      },
    },
    async (args) => {
      try {
        const input = MemoryDismissInputSchema.parse(args);
        const candidate = openDesignReviewDb(ctx.root).dismissPreferenceCandidate({
          key: input.candidateKey,
        });
        return toolText("Dismissed design memory candidate.", { candidate });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_memory_update",
      description: "Edit, reactivate, or deactivate an existing project design preference.",
      inputSchema: {
        type: "object",
        properties: {
          preferenceKey: { type: "string" },
          rule: { type: "string" },
          scope: { type: ["string", "null"] },
          status: { type: "string", enum: ["active", "inactive"] },
        },
        required: ["preferenceKey"],
      },
    },
    async (args) => {
      try {
        const input = MemoryUpdateInputSchema.parse(args);
        const preference = openDesignReviewDb(ctx.root).updateDesignPreference({
          key: input.preferenceKey,
          ...(input.rule !== undefined ? { rule: input.rule } : {}),
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        });
        return toolText("Updated design preference.", { preference });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  registerTool(
    registry,
    {
      name: "kotikit_design_memory_search",
      description: "Search active project design preferences for the current design task.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          category: { type: "string", enum: DesignAdjustmentCategorySchema.options },
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    async (args) => {
      try {
        const input = MemorySearchInputSchema.parse(args);
        const preferences = openDesignReviewDb(ctx.root).searchDesignPreferences({
          ...input,
          ...(input.category !== undefined
            ? { category: input.category as DesignAdjustmentCategory }
            : {}),
        });
        return toolText(`Found ${preferences.length} active design preference(s).`, {
          preferences,
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
