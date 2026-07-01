import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  getLocalComponent,
  searchLocalComponents,
} from "../../core/adapters/design-system/local-index.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { withKotikitToolSafety } from "../tool-safety.js";

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

  registry.tools.push(withKotikitToolSafety(tool));

  registry.handlers.set("kotikit_ds_search", async (args) => {
    try {
      const { query, limit } = args as { query: string; limit?: number };
      const result = searchLocalComponents(ctx.root, query, { limit: limit ?? 25 });
      if (result.status === "needs-sync") {
        return toolError(
          new KotikitError(
            "Your design system hasn't been synced yet.",
            "Use sync_ds to pull it from Figma first."
          )
        );
      }

      return toolText(`Found ${result.results.length} components matching ${query}.`, {
        results: result.results,
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

  registry.tools.push(withKotikitToolSafety(tool));

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

      const json = getLocalComponent(ctx.root, path);

      return toolText(`Here is the ${json.name} component.`, json);
    } catch (err) {
      return toolError(err);
    }
  });
}
