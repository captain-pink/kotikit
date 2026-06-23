import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { defaultConfig } from "../../config/schema.js";
import { openDesignReviewDb } from "../../db/design-review-db.js";
import { readDesignPlan } from "../../planning/design-plan-store.js";
import { readFlowManifest, readScreenSpec } from "../../spec/engine.js";
import { type ComponentJson, ComponentJsonSchema } from "../../sync/component-shape.js";
import { slugifyComponentName } from "../../util/ids.js";
import { designReviewDbPath, designSystemDir } from "../../util/paths.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

// ─── Register all design-screen tools ─────────────────────────────────────────

export function registerDesignScreenTools(registry: ToolRegistry, ctx: ToolContext): void {
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
      (await ctx.loadConfig()) ?? defaultConfig();

      // 2. Read spec — throws KotikitError with friendly message if missing
      const spec = await readScreenSpec(root, scope, screenSlug);

      // 3. Optional flow manifest — silently skip if absent or not a flow scope
      let flow: Awaited<ReturnType<typeof readFlowManifest>> | undefined;
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
      if (plan.target === undefined) {
        throw new KotikitError(
          "This design plan was created before Figma draft-page protection was added.",
          "Ask the designer for the exact Figma draft page link, bind it with kotikit_figma_target_bind, then regenerate the design plan."
        );
      }

      // 5. For each unique componentName in place-component steps, try to load the DS JSON
      const componentNames = Array.from(
        new Set(
          plan.steps
            .filter(
              (s): s is typeof s & { kind: "place-component"; componentName: string } =>
                s.kind === "place-component"
            )
            .map((s) => s.componentName)
        )
      );

      const specComponentByName = new Map(
        spec.components.map((component) => [component.name, component])
      );
      const dsComponents: Record<string, ComponentJson> = {};
      const skipped: { name: string; reason: string }[] = [];
      const componentCreationRequired: { name: string; componentSpecRef?: string }[] = [];
      const inlineDraftRequired: { name: string }[] = [];
      const unresolvedComponents: string[] = [];

      for (const name of componentNames) {
        const specComponent = specComponentByName.get(name);
        const resolution = specComponent?.resolution;
        const slug = slugifyComponentName(name);
        const filePath = `${designSystemDir(root)}/components/${slug}.json`;
        if (!existsSync(filePath)) {
          if (resolution?.kind === "create-draft-component") {
            componentCreationRequired.push({
              name,
              ...(resolution.componentSpecRef !== undefined
                ? { componentSpecRef: resolution.componentSpecRef }
                : {}),
            });
            continue;
          }
          if (resolution?.kind === "inline-draft" && resolution.status === "approved") {
            inlineDraftRequired.push({ name });
            continue;
          }
          unresolvedComponents.push(name);
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

      if (unresolvedComponents.length > 0) {
        throw new KotikitError(
          `This screen needs a component decision before I can create the Figma design.`,
          `Missing component${unresolvedComponents.length === 1 ? "" : "s"}: ${unresolvedComponents.join(", ")}.\n` +
            `Ask the designer how to proceed:\n` +
            `- Create reusable draft components first\n` +
            `- Build them inline in this page only`
        );
      }

      const designPreferences = existsSync(designReviewDbPath(root))
        ? openDesignReviewDb(root).searchDesignPreferences({ scope, limit: 10 })
        : [];

      return toolText(`Design plan for ${plan.pageName}: ${plan.steps.length} steps.`, {
        plan,
        spec,
        ...(flow ? { flow } : {}),
        dsComponents,
        skipped,
        componentCreationRequired,
        inlineDraftRequired,
        designPreferences,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}
