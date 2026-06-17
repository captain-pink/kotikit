import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { FigmaClient } from "../../sync/figma-client.js";
import type { FigmaComment } from "../../sync/figma-types.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import { readDesignNodeMap } from "../../planning/design-node-map.js";
import { mapCommentsToDesignNodes } from "../../planning/design-comments.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";

export interface FigmaCommentsClient {
  getComments(fileKey: string, opts?: { asMarkdown?: boolean }): Promise<FigmaComment[]>;
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

const sliceComments = <T>(items: T[], limit: number): T[] => items.slice(0, limit);

const resolveNodeMap = async (
  root: string,
  input: ReviewCommentsInput
) => {
  if (input.scope === undefined) return null;
  return readDesignNodeMap(root, input.scope, input.screen ?? null);
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
        fileKey: { type: "string", description: "Figma file key. Optional when a node map has figmaFileKey." },
        includeResolved: { type: "boolean", description: "Include resolved comments. Defaults to false." },
        limit: { type: "number", description: "Maximum mapped and unmapped comments returned per bucket. Defaults to 25, max 200." },
      },
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_design_review_comments", async (args) => {
    try {
      const input = ReviewCommentsInputSchema.parse(args);
      const config = await ctx.loadConfig();
      const token = await resolveFigmaToken(ctx.root, config);
      if (token === undefined || token === "") {
        return toolError(
          new KotikitError(
            "I couldn't find your Figma token.",
            "Create a .env file in your project root with FIGMA_TOKEN=figd_... or set figma.token in .kotikit/config.json. The token must include file_comments:read."
          )
        );
      }

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

      const client = opts.figmaClientFactory
        ? opts.figmaClientFactory(token)
        : new FigmaClient({ token });
      const comments = await client.getComments(fileKey, { asMarkdown: true });
      const mapped = mapCommentsToDesignNodes(comments, nodeMap, {
        includeResolved: input.includeResolved,
      });
      const detail = {
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
      };

      return toolText(
        `Fetched ${comments.length} Figma comment(s): ${mapped.mapped.length} mapped, ${mapped.unmapped.length} unmapped.`,
        detail
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
