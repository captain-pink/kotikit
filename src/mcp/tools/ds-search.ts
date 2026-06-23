import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { searchComponents } from "../../db/components-db.js";
import { ComponentJsonSchema } from "../../sync/component-shape.js";
import { componentsDbPath, designSystemDir } from "../../util/paths.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

// ─── Register all ds-search tools ────────────────────────────────────────────

export function registerDsSearchTools(registry: ToolRegistry, ctx: ToolContext): void {
  registerDsSearch(registry, ctx);
  registerDsGetComponent(registry, ctx);
}

// ─── kotikit_ds_search ────────────────────────────────────────────────────────

function registerDsSearch(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_ds_search",
    description:
      "Search the local design-system mirror for components by name. " +
      'Supports FTS5 match expressions (e.g. "but*", "button OR card").',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "FTS5 match expression to search for.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 25).",
        },
      },
      required: ["query"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_ds_search", async (args) => {
    try {
      const { query, limit } = args as { query: string; limit?: number };

      // Guard: design-system directory must exist
      if (!existsSync(designSystemDir(ctx.root))) {
        return toolError(
          new KotikitError(
            "Your design system hasn't been synced yet.",
            "Use sync_ds to pull it from Figma first."
          )
        );
      }

      // Guard: components DB must exist
      if (!existsSync(componentsDbPath(ctx.root))) {
        return toolError(
          new KotikitError(
            "Your design system hasn't been synced yet.",
            "Use sync_ds to pull it from Figma first."
          )
        );
      }

      const db = new Database(componentsDbPath(ctx.root), { readonly: true });
      let results: ReturnType<typeof searchComponents>;
      try {
        results = searchComponents(db, query, limit ?? 25);
      } finally {
        db.close();
      }

      return toolText(`Found ${results.length} components matching ${query}.`, {
        results,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_ds_get_component ─────────────────────────────────────────────────

function registerDsGetComponent(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_ds_get_component",
    description:
      "Read a single component JSON file from the local design-system mirror. " +
      'Pass the `path` returned by ds_search (e.g. "components/button.json").',
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to the component file within design-system/ " +
            '(e.g. "components/button.json").',
        },
      },
      required: ["path"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_ds_get_component", async (args) => {
    try {
      const { path } = args as { path: string };

      // Guard: reject path traversal
      if (path.includes("..") || path.startsWith("/")) {
        return toolError(
          new KotikitError(
            "That path looks unsafe.",
            'Use a relative path returned by ds_search, e.g. "components/button.json".'
          )
        );
      }

      const absolutePath = `${designSystemDir(ctx.root)}/${path}`;

      if (!existsSync(absolutePath)) {
        return toolError(
          new KotikitError(
            "I couldn't find that component.",
            "Use ds_search to find available components."
          )
        );
      }

      const raw = await readFile(absolutePath, "utf-8");
      const json = ComponentJsonSchema.parse(JSON.parse(raw));

      return toolText(`Here is the ${json.name} component.`, json);
    } catch (err) {
      return toolError(err);
    }
  });
}
