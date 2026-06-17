import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { writeScreenSpec, writeFlowManifest } from "../../spec/engine.js";
import { materializeFlow, type FlowDraft } from "../../spec/decompose.js";
import { autoCommitSpec } from "../../git/auto-commit.js";
import { defaultConfig } from "../../config/schema.js";
import { toolText, toolError } from "../../util/result.js";
import { indexPath } from "../../util/paths.js";

// ─── Registry shape (mirrors server.ts) ──────────────────────────────────────

type McpContent = { type: "text"; text: string };
type Handler = (
  args: unknown
) => Promise<{ content: McpContent[]; isError?: boolean }>;

// ─── Register all flow tools ──────────────────────────────────────────────────

export function registerFlowTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registerFlowCreate(registry, ctx);
}

// ─── kotikit_flow_create ──────────────────────────────────────────────────────

function registerFlowCreate(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_flow_create",
    description:
      "Create a new multi-screen flow: writes a flow manifest and all screen specs, then commits everything in one commit.",
    inputSchema: {
      type: "object",
      properties: {
        draft: {
          type: "object",
          description: "FlowDraft describing the flow scope, screens, and transitions.",
        },
      },
      required: ["draft"],
    },
  };

  registry.tools.push(tool);

  const handler: Handler = async (args) => {
    try {
      const { root } = ctx;
      const { draft } = args as { draft: FlowDraft };

      const config = (await ctx.loadConfig()) ?? defaultConfig();
      const enabled = config.git.autoCommit;

      const scope = draft.scope;
      const { manifest, specs } = materializeFlow(draft);

      // Write screen specs first, then manifest last so the index reflects
      // the flow entry (kind: "flow", all screens) as the final write.
      const specPaths: string[] = [];
      for (const { screenSlug, spec } of specs) {
        const p = await writeScreenSpec(root, scope, screenSlug, spec);
        specPaths.push(p);
      }
      const manifestPath = await writeFlowManifest(root, scope, manifest);

      // One single commit for everything — never one per screen.
      await autoCommitSpec({
        root,
        scope,
        kind: "create",
        files: [manifestPath, ...specPaths, indexPath(root)],
        enabled,
        coAuthor: config.git.coAuthor,
      });

      const screenSlugs = specs.map((s) => s.screenSlug).join(", ");
      const n = specs.length;

      return toolText(
        `Created the ${draft.title} flow: ${n} screen${n === 1 ? "" : "s"} (${screenSlugs}) saved and committed.`,
        { manifestPath, screenCount: n }
      );
    } catch (err) {
      return toolError(err);
    }
  };

  registry.handlers.set("kotikit_flow_create", handler);
}
