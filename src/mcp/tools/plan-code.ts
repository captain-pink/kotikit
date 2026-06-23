import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { defaultConfig } from "../../config/schema.js";
import { generateCodePlan } from "../../planning/code-planner.js";
import { writeCodePlan } from "../../planning/plan-store.js";
import { readFlowManifest, readScreenSpec } from "../../spec/engine.js";
import type { FlowManifest } from "../../spec/schema.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

// ─── Register all plan-code tools ─────────────────────────────────────────────

export function registerPlanCodeTools(registry: ToolRegistry, ctx: ToolContext): void {
  registerPlanCode(registry, ctx);
}

// ─── kotikit_plan_code ────────────────────────────────────────────────────────

function registerPlanCode(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_plan_code",
    description: "Generate the ephemeral per-screen code plan for a spec.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Scope (flow or single-screen folder) slug.",
        },
        screen: {
          type: "string",
          description: "Screen slug within a flow. Omit for single-screen specs.",
        },
      },
      required: ["scope"],
    },
  } satisfies Tool);

  registry.handlers.set("kotikit_plan_code", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen } = args as { scope: string; screen?: string };
      const screenSlug = screen ?? null;

      // 1. Load config (fall back to defaults when config is not yet written)
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // 2. Read the spec — surface a friendly error when missing
      let spec;
      try {
        spec = await readScreenSpec(root, scope, screenSlug);
      } catch (err) {
        if (err instanceof KotikitError) {
          throw new KotikitError(
            `I couldn't find the spec for "${screenSlug ?? scope}". ` +
              `Make sure the scope and screen names are correct, or create the spec first.`,
            err.hint
          );
        }
        throw err;
      }

      // 3. Try to read the flow manifest; ignore if absent
      let flowManifest: FlowManifest | undefined;
      try {
        flowManifest = await readFlowManifest(root, scope);
      } catch {
        flowManifest = undefined;
      }

      // 4. Generate the code plan (pure, no I/O)
      const plan = generateCodePlan({
        root,
        scope,
        screen: screenSlug,
        spec,
        flowManifest,
        config,
      });

      // 5. Write the plan to disk
      const planPath = await writeCodePlan(root, scope, screenSlug, plan);

      // 6. Return a friendly summary
      return toolText(`Code plan written. ${plan.steps.length} steps for ${plan.componentName}.`, {
        planPath,
        plan,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}
