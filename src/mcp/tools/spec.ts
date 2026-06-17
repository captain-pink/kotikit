import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import { defaultConfig } from "../../config/schema.js";
import {
  writeScreenSpec,
  readScreenSpec,
  writeFlowManifest,
  readFlowManifest,
  listScopes,
} from "../../spec/engine.js";
import {
  materializeFlow,
  materializeSingle,
  isMultiScreen,
  type FlowDraft,
  type SingleDraft,
} from "../../spec/decompose.js";
import { autoCommitSpec } from "../../git/auto-commit.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";
import { indexPath, flowManifestPath } from "../../util/paths.js";
import { nowIso } from "../../util/ids.js";
import { parseScreenSpec } from "../../spec/schema.js";
import type { ScreenSpec } from "../../spec/schema.js";

// ─── Registry shape ───────────────────────────────────────────────────────────

type McpContent = { type: "text"; text: string };
type Handler = (
  args: unknown
) => Promise<{ content: McpContent[]; isError?: boolean }>;

export interface ToolRegistry {
  tools: Tool[];
  handlers: Map<string, Handler>;
}

// ─── Register all spec tools ──────────────────────────────────────────────────

export function registerSpecTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registerSpecCreate(registry, ctx);
  registerSpecGet(registry, ctx);
  registerSpecList(registry, ctx);
  registerSpecUpdate(registry, ctx);
}

// ─── kotikit_spec_create ──────────────────────────────────────────────────────

function registerSpecCreate(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_spec_create",
    description:
      "Create a new screen spec (single or multi-screen flow) and optionally auto-commit it.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Optional slug override for the scope directory.",
        },
        draft: {
          type: "object",
          description: "FlowDraft or SingleDraft shape.",
        },
      },
      required: ["draft"],
    },
  });

  registry.handlers.set("kotikit_spec_create", async (args) => {
    try {
      const { root } = ctx;
      const { scope: scopeOverride, draft } = args as {
        scope?: string;
        draft: FlowDraft | SingleDraft;
      };

      const config = (await ctx.loadConfig()) ?? defaultConfig();
      const enabled = config.git.autoCommit;

      if (isMultiScreen(draft)) {
        // Multi-screen flow
        const scope = scopeOverride ?? draft.scope;
        const { manifest, specs } = materializeFlow(draft);

        // Write screen specs first, then manifest last so the index
        // ends up with the flow entry (kind: "flow", all screens) rather
        // than the final individual screen write overwriting it.
        const specPaths: string[] = [];
        for (const { screenSlug, spec } of specs) {
          const p = await writeScreenSpec(root, scope, screenSlug, spec);
          specPaths.push(p);
        }
        const manifestPath = await writeFlowManifest(root, scope, manifest);

        const commitResult = await autoCommitSpec({
          root,
          scope,
          kind: "create",
          files: [manifestPath, ...specPaths, indexPath(root)],
          enabled,
          coAuthor: config.git.coAuthor,
        });

        return toolText(
          `Created the ${scope} flow with ${specs.length} screen(s) and committed it (${commitResult.message}).`,
          { paths: [manifestPath, ...specPaths] }
        );
      } else {
        // Single screen
        const scope = scopeOverride ?? draft.scope;
        const { spec } = materializeSingle(draft);

        const writtenPath = await writeScreenSpec(root, scope, null, spec);

        const commitResult = await autoCommitSpec({
          root,
          scope,
          kind: "create",
          files: [writtenPath, indexPath(root)],
          enabled,
          coAuthor: config.git.coAuthor,
        });

        return toolText(
          `Created the ${scope} screen and committed it (${commitResult.message}).`,
          { paths: [writtenPath] }
        );
      }
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_spec_get ─────────────────────────────────────────────────────────

function registerSpecGet(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_spec_get",
    description:
      "Read a screen spec or flow manifest. Omit `screen` to read the single-screen spec or flow manifest.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "The scope (directory) slug." },
        screen: {
          type: "string",
          description: "Screen slug within a flow. Omit for single-screen specs.",
        },
      },
      required: ["scope"],
    },
  });

  registry.handlers.set("kotikit_spec_get", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen } = args as { scope: string; screen?: string };

      if (screen) {
        // Read named screen spec within a flow or scope
        const spec = await readScreenSpec(root, scope, screen);
        return toolText(`Here is the ${spec.title} spec.`, spec);
      }

      // Try reading single-screen spec first
      try {
        const spec = await readScreenSpec(root, scope, null);
        return toolText(`Here is the ${spec.title} spec.`, spec);
      } catch {
        // Fall back to flow manifest — list screen names in error if manifest also missing
        try {
          const manifest = await readFlowManifest(root, scope);
          const screenNames = manifest.screens.map((s) => s.id).join(", ");
          throw new KotikitError(
            `"${scope}" is a multi-screen flow. Please specify which screen to read.`,
            `Available screens: ${screenNames}. Use spec_get with a screen parameter.`
          );
        } catch (innerErr) {
          if (innerErr instanceof KotikitError) throw innerErr;
          throw new KotikitError(
            `I couldn't find any spec for "${scope}".`,
            `Use spec_list to see what exists, or create it with spec_create.`
          );
        }
      }
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_spec_list ────────────────────────────────────────────────────────

function registerSpecList(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_spec_list",
    description: "List all known specs and flows. Never reads spec bodies.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  });

  registry.handlers.set("kotikit_spec_list", async (_args) => {
    try {
      const { root } = ctx;
      const entries = await listScopes(root);

      if (entries.length === 0) {
        return toolText("No specs found. Create one with spec_create.");
      }

      const lines = entries.map((e) => {
        const screensLabel = e.screens.join(", ") || "(none)";
        return `• ${e.title} (${e.kind}, ${e.status}) — ${e.screens.length} screen(s): ${screensLabel}`;
      });

      return toolText("Here are all your specs:", lines.join("\n"));
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_spec_update ──────────────────────────────────────────────────────

function registerSpecUpdate(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_spec_update",
    description: "Patch a screen spec. Cannot change id or type.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "The scope (directory) slug." },
        screen: {
          type: "string",
          description: "Screen slug for multi-screen flows. Omit for single-screen specs.",
        },
        patch: {
          type: "object",
          description: "Partial ScreenSpec fields to merge.",
        },
      },
      required: ["scope", "patch"],
    },
  });

  registry.handlers.set("kotikit_spec_update", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen, patch } = args as {
        scope: string;
        screen?: string;
        patch: Partial<ScreenSpec>;
      };

      // Reject immutable fields
      if ("id" in patch) {
        return toolError(
          new KotikitError(
            "You can't change a spec's id or type.",
            "These fields are fixed and cannot be patched."
          )
        );
      }
      if ("type" in patch) {
        return toolError(
          new KotikitError(
            "You can't change a spec's id or type.",
            "These fields are fixed and cannot be patched."
          )
        );
      }

      const config = (await ctx.loadConfig()) ?? defaultConfig();
      const enabled = config.git.autoCommit;

      // Read existing
      const existing = await readScreenSpec(root, scope, screen ?? null);

      // Deep-merge patch (patch overrides top-level keys; nested objects are merged)
      const updated: ScreenSpec = {
        ...existing,
        ...patch,
        // Preserve immutable fields
        id: existing.id,
        type: existing.type,
        // Merge nested objects if patch includes them
        context:
          patch.context != null
            ? { ...existing.context, ...patch.context }
            : existing.context,
        requirements:
          patch.requirements != null
            ? { ...existing.requirements, ...patch.requirements }
            : existing.requirements,
        metadata: {
          ...existing.metadata,
          ...(patch.metadata ?? {}),
          updatedAt: nowIso(),
        },
      };

      // Re-validate
      const validated = parseScreenSpec(updated);

      // Write back
      const writtenPath = await writeScreenSpec(root, scope, screen ?? null, validated);

      const commitResult = await autoCommitSpec({
        root,
        scope,
        kind: "update",
        files: [writtenPath, indexPath(root)],
        enabled,
        coAuthor: config.git.coAuthor,
      });

      return toolText(
        `Updated ${validated.title}. ${commitResult.message}`
      );
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── Re-export flowManifestPath to satisfy the import (used only when building manifest path for multi-flow commits) ─
void (flowManifestPath as unknown);
