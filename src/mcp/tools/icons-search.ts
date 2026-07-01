import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { searchLocalIcons } from "../../core/adapters/design-system/local-index.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { withKotikitToolSafety } from "../tool-safety.js";

// ─── Register icons search tools ──────────────────────────────────────────────

export function registerIconsSearchTools(registry: ToolRegistry, ctx: ToolContext): void {
  registerIconsSearch(registry, ctx);
}

// ─── kotikit_icons_search ─────────────────────────────────────────────────────

function registerIconsSearch(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_icons_search",
    description:
      "Search the local design-system icon index. Returns matching icons ordered by relevance. SVG payloads are omitted by default to keep results token-cheap — set includeSvg: true to include them.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'FTS5 query string, e.g. "arrow*", "arrow right", "icon/arrow".',
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Default: 50.",
        },
        includeSvg: {
          type: "boolean",
          description: "When true, each result includes the raw SVG string. Default: false.",
        },
      },
      required: ["query"],
    },
  };

  registry.tools.push(withKotikitToolSafety(tool));

  registry.handlers.set("kotikit_icons_search", async (args) => {
    try {
      const { query, limit, includeSvg } = args as {
        query: string;
        limit?: number;
        includeSvg?: boolean;
      };

      const result = searchLocalIcons(ctx.root, query, {
        limit: limit ?? 50,
        includeSvg: includeSvg === true,
      });
      if (result.status === "needs-sync") {
        return toolError(
          new KotikitError(
            "Your design system hasn't been synced yet.",
            "Use sync_ds to pull it from Figma first."
          )
        );
      }

      return toolText(`Found ${result.results.length} icons matching ${query}.`, {
        results: result.results,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}
