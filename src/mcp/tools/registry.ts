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
    description: "Search the kotikit component registry by name prefix, status, and/or kind.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name prefix to search for (optional)." },
        status: {
          type: "string",
          enum: ["code-only", "design-only", "synced"],
          description: "Filter by status (optional).",
        },
        kind: {
          type: "string",
          enum: ["screen", "component"],
          description: "Filter by kind (optional).",
        },
        limit: {
          type: "number",
          description: "Maximum rows to return (default 25).",
        },
      },
    },
  });

  registry.handlers.set("kotikit_registry_search", async (args) => {
    try {
      const { query, status, kind, limit } = args as {
        query?: string;
        status?: "code-only" | "design-only" | "synced";
        kind?: "screen" | "component";
        limit?: number;
      };
      const dbPath = registryDbPath(ctx.root);

      // Registry is empty — not an error, just no results yet.
      if (!existsSync(dbPath)) {
        return toolText("Registry is empty.", { results: [] });
      }

      const db = new Database(dbPath, { readonly: true });
      const results = searchRegistry(db, { query, status, kind, limit: limit ?? 25 });
      db.close();

      // Build a friendly summary mentioning the applied filters
      const filterParts: string[] = [];
      if (status) filterParts.push(status);
      if (kind) filterParts.push(kind);
      const filterPhrase = filterParts.length > 0 ? ` ${filterParts.join(" ")}` : "";
      const queryPhrase = query ? ` matching "${query}"` : "";
      const summary = `Found ${results.length}${filterPhrase} registry entr${results.length === 1 ? "y" : "ies"}${queryPhrase}.`;

      return toolText(summary, { results });
    } catch (err) {
      return toolError(err);
    }
  });
}
