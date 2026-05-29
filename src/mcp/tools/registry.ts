import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { searchRegistry } from "../../db/registry-db.js";
import { registryDbPath } from "../../util/paths.js";
import { toolText, toolError } from "../../util/result.js";

// ─── Register all registry tools ─────────────────────────────────────────────

export function registerRegistryTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registerRegistrySearch(registry, ctx);
}

// ─── kotikit_registry_search ─────────────────────────────────────────────────

function registerRegistrySearch(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registry.tools.push({
    name: "kotikit_registry_search",
    description: "Search the kotikit component registry by name prefix.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name prefix to search for." },
        limit: {
          type: "number",
          description: "Maximum rows to return (default 25).",
        },
      },
      required: ["query"],
    },
  });

  registry.handlers.set("kotikit_registry_search", async (args) => {
    try {
      const { query, limit } = args as { query: string; limit?: number };
      const dbPath = registryDbPath(ctx.root);

      // Registry is empty — not an error, just no results yet.
      if (!existsSync(dbPath)) {
        return toolText("Registry is empty.", { results: [] });
      }

      const db = new Database(dbPath, { readonly: true });
      const results = searchRegistry(db, { query, limit: limit ?? 25 });
      db.close();

      return toolText(
        `Found ${results.length} code component${results.length === 1 ? "" : "s"} matching ${query}.`,
        { results }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
