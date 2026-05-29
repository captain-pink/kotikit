import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { defaultConfig } from "../../config/schema.js";
import { readScreenSpec, readFlowManifest } from "../../spec/engine.js";
import { readDesignPlan } from "../../planning/design-plan-store.js";
import { ComponentJsonSchema, type ComponentJson } from "../../sync/component-shape.js";
import { designSystemDir } from "../../util/paths.js";
import { slugifyComponentName } from "../../util/ids.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";

// ─── Register all design-screen tools ─────────────────────────────────────────

export function registerDesignScreenTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registerDesignGetScreen(registry, ctx);
  // P5-C3 will add: registerDesignApplyStep(registry, ctx);
}

// ─── kotikit_design_get_screen ────────────────────────────────────────────────

function registerDesignGetScreen(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_design_get_screen",
    description: "Fetch the design plan + spec + DS component bundle for one screen.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope (flow or single-screen folder) slug." },
        screen: { type: "string", description: "Screen slug. Omit for single-screen specs." },
      },
      required: ["scope"],
    },
  } satisfies Tool);

  registry.handlers.set("kotikit_design_get_screen", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen } = args as { scope: string; screen?: string };
      const screenSlug = screen ?? null;

      // 1. Load config (fall back to defaults when config is not yet written)
      await ctx.loadConfig() ?? defaultConfig();

      // 2. Read spec — throws KotikitError with friendly message if missing
      const spec = await readScreenSpec(root, scope, screenSlug);

      // 3. Optional flow manifest — silently skip if absent or not a flow scope
      let flow;
      try {
        flow = await readFlowManifest(root, scope);
      } catch {
        flow = undefined;
      }

      // 4. Read design plan — required for this tool
      const plan = await readDesignPlan(root, scope, screenSlug);
      if (!plan) {
        throw new KotikitError(
          `No design plan yet for ${scope}${screenSlug ? "/" + screenSlug : ""}.`,
          `Call plan_design first to generate the plan.`
        );
      }

      // 5. For each unique componentName in place-component steps, try to load the DS JSON
      const componentNames = Array.from(new Set(
        plan.steps
          .filter((s): s is typeof s & { kind: "place-component"; componentName: string } =>
            s.kind === "place-component"
          )
          .map((s) => s.componentName)
      ));

      const dsComponents: Record<string, ComponentJson> = {};
      const skipped: { name: string; reason: string }[] = [];

      for (const name of componentNames) {
        const slug = slugifyComponentName(name);
        const filePath = `${designSystemDir(root)}/components/${slug}.json`;
        if (!existsSync(filePath)) {
          skipped.push({ name, reason: "DS component JSON not found" });
          continue;
        }
        try {
          const text = await readFile(filePath, "utf-8");
          const parsed = ComponentJsonSchema.parse(JSON.parse(text));
          dsComponents[name] = parsed;
        } catch (err) {
          skipped.push({ name, reason: (err as Error).message });
        }
      }

      return toolText(
        `Design plan for ${plan.pageName}: ${plan.steps.length} steps.`,
        { plan, spec, ...(flow ? { flow } : {}), dsComponents, skipped }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
