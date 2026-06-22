import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { FigmaClient } from "../../sync/figma-client.js";
import type { FigmaComment } from "../../sync/figma-types.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import { openDesignReviewDb } from "../../db/design-review-db.js";
import {
  collectDesignReviewEvidence,
  parseFigmaReviewUrl,
  type DesignReviewEvidenceClient,
} from "../../planning/design-review.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";

export interface FigmaDesignReviewClient extends DesignReviewEvidenceClient {
  postComment?(
    fileKey: string,
    input: { message: string; commentId?: string; clientMeta?: unknown }
  ): Promise<FigmaComment>;
}

export interface RegisterDesignReviewToolsOpts {
  figmaClientFactory?: (token: string) => FigmaDesignReviewClient;
}

const FindingCategorySchema = z.enum([
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
  "accessibility",
  "content",
  "system",
  "visual",
]);

const FindingInputSchema = z.object({
  category: FindingCategorySchema,
  severity: z.enum(["critical", "high", "medium", "polish"]),
  confidence: z.enum(["observed", "inferred", "needs-decision"]),
  title: z.string().min(1),
  observation: z.string().min(1),
  rationale: z.string().min(1),
  recommendation: z.string().min(1),
  nodeId: z.string().optional(),
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
  commentable: z.boolean(),
  suggestedComment: z.string().min(1).optional(),
});

const ReviewStartInputSchema = z.object({
  figmaUrl: z.string().optional(),
  fileKey: z.string().optional(),
  nodeId: z.string().optional(),
  scope: z.string().optional(),
  screen: z.string().optional(),
  surfaceType: z.string().optional(),
  audience: z.string().optional(),
  primaryUserGoal: z.string().optional(),
  reviewGoal: z.string().optional(),
  strictness: z.enum(["quick", "standard", "deep"]).optional().default("standard"),
  notes: z.string().optional(),
  maxRegions: z.number().int().positive().max(30).optional().default(8),
});

const ReviewRecordInputSchema = z.object({
  sessionId: z.string().min(1),
  findings: z.array(FindingInputSchema).min(1).max(50),
});

const ReviewGetInputSchema = z.object({
  sessionId: z.string().optional(),
  fileKey: z.string().optional(),
  limit: z.number().int().positive().max(100).optional().default(25),
});

const ReviewCommentPrepareInputSchema = z.object({
  sessionId: z.string().min(1),
  findingIds: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional().default(12),
});

const ReviewCommentPostInputSchema = z.object({
  sessionId: z.string().optional(),
  fileKey: z.string().optional(),
  outboxIds: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional().default(10),
  confirm: z.literal(true),
});

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
  opts: RegisterDesignReviewToolsOpts
): Promise<FigmaDesignReviewClient | ReturnType<typeof toolError>> => {
  const config = await ctx.loadConfig();
  const token = await resolveFigmaToken(ctx.root, config);
  if (token === undefined || token === "") {
    return toolError(
      new KotikitError(
        "I couldn't find your Figma token.",
        "Create a .env file in your project root with FIGMA_TOKEN=figd_... or set figma.token in .kotikit/config.json. Design review needs file_read; posting comments needs file_comments:write."
      )
    );
  }
  return opts.figmaClientFactory?.(token) ?? new FigmaClient({ token });
};

const targetFromStartInput = (input: z.infer<typeof ReviewStartInputSchema>) => {
  if (input.figmaUrl !== undefined) {
    return parseFigmaReviewUrl(input.figmaUrl);
  }
  if (input.fileKey !== undefined && input.nodeId !== undefined) {
    return {
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      figmaUrl: `https://www.figma.com/design/${input.fileKey}/review?node-id=${input.nodeId.replace(":", "-")}`,
    };
  }
  throw new KotikitError(
    "I need an exact Figma target to review.",
    "Pass figmaUrl with node-id, or pass both fileKey and nodeId."
  );
};

const parsedCommentMeta = (value: string | null): unknown | undefined =>
  value === null ? undefined : JSON.parse(value);

export function registerDesignReviewTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterDesignReviewToolsOpts = {}
): void {
  registerTool(registry, {
    name: "kotikit_design_review_start",
    description:
      "Start a token-bounded design review for an exact Figma page, section, frame, or component target.",
    inputSchema: {
      type: "object",
      properties: {
        figmaUrl: { type: "string", description: "Exact Figma URL with node-id." },
        fileKey: { type: "string", description: "Figma file key, used with nodeId when figmaUrl is omitted." },
        nodeId: { type: "string", description: "Figma node id, used with fileKey when figmaUrl is omitted." },
        scope: { type: "string", description: "Optional kotikit scope to link the review to." },
        screen: { type: "string", description: "Optional kotikit screen to link the review to." },
        surfaceType: { type: "string", description: "App screen, dashboard, landing page, component, mobile flow, etc." },
        audience: { type: "string" },
        primaryUserGoal: { type: "string" },
        reviewGoal: { type: "string" },
        strictness: { type: "string", enum: ["quick", "standard", "deep"] },
        notes: { type: "string" },
        maxRegions: { type: "number", description: "Maximum shallow child regions returned. Defaults to 8, max 30." },
      },
    },
  }, async (args) => {
    try {
      const input = ReviewStartInputSchema.parse(args);
      const clientOrError = await requireFigmaClient(ctx, opts);
      if ("isError" in clientOrError) return clientOrError;
      const store = openDesignReviewDb(ctx.root);
      const parsedTarget = targetFromStartInput(input);
      const { target, evidence } = await collectDesignReviewEvidence({
        client: clientOrError,
        store,
        target: {
          ...parsedTarget,
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          ...(input.screen !== undefined ? { screen: input.screen } : {}),
        },
        maxRegions: input.maxRegions,
      });
      const session = store.recordDesignAuditSession({
        target,
        brief: {
          strictness: input.strictness,
          ...(input.surfaceType !== undefined ? { surfaceType: input.surfaceType } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.primaryUserGoal !== undefined ? { primaryUserGoal: input.primaryUserGoal } : {}),
          ...(input.reviewGoal !== undefined ? { reviewGoal: input.reviewGoal } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        evidence,
      });

      return toolText("Started design review with bounded Figma evidence.", {
        sessionId: session.sessionId,
        target,
        evidence,
        next: "Use the design-review rubric, then call kotikit_design_review_record with structured findings.",
      });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_design_review_record",
    description: "Persist structured findings from an agent design review.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        findings: { type: "array", items: { type: "object" } },
      },
      required: ["sessionId", "findings"],
    },
  }, async (args) => {
    try {
      const input = ReviewRecordInputSchema.parse(args);
      const store = openDesignReviewDb(ctx.root);
      const findings = store.recordDesignAuditFindings(input);
      return toolText(`Recorded ${findings.length} design review finding(s).`, { findings });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_design_review_get",
    description: "Return a compact standalone design review report with findings and pending comment outbox rows.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        fileKey: { type: "string" },
        limit: { type: "number" },
      },
    },
  }, async (args) => {
    try {
      const input = ReviewGetInputSchema.parse(args);
      const report = openDesignReviewDb(ctx.root).getDesignAuditReport(input);
      return toolText("Design review audit report.", report);
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_design_review_comment_prepare",
    description: "Prepare pending root Figma comments for commentable design review findings without posting them.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        findingIds: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: ["sessionId"],
    },
  }, async (args) => {
    try {
      const input = ReviewCommentPrepareInputSchema.parse(args);
      const comments = openDesignReviewDb(ctx.root).prepareDesignAuditComments(input);
      return toolText(`Prepared ${comments.length} Figma review comment(s).`, { comments });
    } catch (err) {
      return toolError(err);
    }
  });

  registerTool(registry, {
    name: "kotikit_design_review_comment_post",
    description: "Post prepared design review comments to Figma. Requires explicit confirm: true and file_comments:write.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        fileKey: { type: "string" },
        outboxIds: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        confirm: { type: "boolean", description: "Must be true after the user approves posting comments." },
      },
      required: ["confirm"],
    },
  }, async (args) => {
    try {
      const parsed = ReviewCommentPostInputSchema.safeParse(args);
      if (!parsed.success) {
        throw new KotikitError(
          "I need explicit confirmation before posting Figma review comments.",
          "Ask the designer if they want these comments posted, then call this tool with confirm: true."
        );
      }
      const input = parsed.data;
      const store = openDesignReviewDb(ctx.root);
      const pending = store.listPendingDesignAuditComments({
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.fileKey !== undefined ? { fileKey: input.fileKey } : {}),
        ...(input.outboxIds !== undefined ? { outboxIds: input.outboxIds } : {}),
        limit: input.limit,
      });
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
      for (const comment of pending) {
        try {
          const figmaComment = await clientOrError.postComment(comment.fileKey, {
            message: comment.message,
            clientMeta: parsedCommentMeta(comment.clientMetaJson),
          });
          store.markDesignAuditCommentPosted({
            outboxId: comment.outboxId,
            postedCommentId: figmaComment.id,
          });
          posted.push({
            outboxId: comment.outboxId,
            findingId: comment.findingId,
            postedCommentId: figmaComment.id,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          store.markDesignAuditCommentFailed({ outboxId: comment.outboxId, error: message });
          failed.push({ outboxId: comment.outboxId, findingId: comment.findingId, error: message });
        }
      }

      return toolText(`Posted ${posted.length} Figma review comment(s).`, { posted, failed });
    } catch (err) {
      return toolError(err);
    }
  });
}
