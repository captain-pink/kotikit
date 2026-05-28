import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { searchIcons, getIconSvg } from "../../db/icons-db.js";
import { iconsDbPath, designSystemDir } from "../../util/paths.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";

// ─── Register icons search tools ──────────────────────────────────────────────

export function registerIconsSearchTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
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
          description:
            'FTS5 query string, e.g. "arrow*", "arrow right", "icon/arrow".',
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Default: 50.",
        },
        includeSvg: {
          type: "boolean",
          description:
            "When true, each result includes the raw SVG string. Default: false.",
        },
      },
      required: ["query"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_icons_search", async (args) => {
    try {
      const { query, limit, includeSvg } = args as {
        query: string;
        limit?: number;
        includeSvg?: boolean;
      };

      // Guard: design-system directory or icons.db must exist
      if (
        !existsSync(designSystemDir(ctx.root)) ||
        !existsSync(iconsDbPath(ctx.root))
      ) {
        return toolError(
          new KotikitError(
            "Your design system hasn't been synced yet.",
            "Use sync_ds to pull it from Figma first."
          )
        );
      }

      const db = new Database(iconsDbPath(ctx.root), { readonly: true });

      try {
        const rows = searchIcons(db, query, limit ?? 50);

        let results: Array<{
          name: string;
          key: string;
          signal: string;
          fileKey: string;
          svg?: string;
        }>;

        if (includeSvg === true) {
          results = rows.map((row) => ({
            ...row,
            svg: getIconSvg(db, row.name) ?? undefined,
          }));
        } else {
          results = rows;
        }

        return toolText(`Found ${results.length} icons matching ${query}.`, {
          results,
        });
      } finally {
        db.close();
      }
    } catch (err) {
      return toolError(err);
    }
  });
}
