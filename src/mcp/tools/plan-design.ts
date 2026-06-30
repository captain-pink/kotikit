import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { defaultConfig } from "../../config/schema.js";
import { readFigmaDraftTarget } from "../../figma/draft-target-store.js";
import { autoCommit } from "../../git/auto-commit.js";
import { readDesignPlan, writeDesignPlan } from "../../planning/design-plan-store.js";
import { generateDesignPlan } from "../../planning/design-planner.js";
import { readFlowManifest, readScreenSpec } from "../../spec/engine.js";
import { designPlanPath } from "../../util/paths.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

// Avoid the unused-locals warning for KotikitError if it isn't used inline
void (KotikitError as unknown);

export function registerPlanDesignTools(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_plan_design",
    description:
      "Deprecated compatibility tool. Prefer graph draft nodes through kotikit_start/kotikit_continue. Generates the per-screen design plan from a spec.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope (flow or single-screen folder) slug." },
        screen: {
          type: "string",
          description: "Screen slug within a flow. Omit for single-screen specs.",
        },
      },
      required: ["scope"],
    },
  } satisfies Tool);

  registry.handlers.set("kotikit_plan_design", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen } = args as { scope: string; screen?: string };

      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // Read spec — friendly error on missing
      const spec = await readScreenSpec(root, scope, screen ?? null);

      // Optional flow manifest
      let flowManifest: Awaited<ReturnType<typeof readFlowManifest>> | undefined;
      try {
        flowManifest = await readFlowManifest(root, scope);
      } catch {
        flowManifest = undefined;
      }

      const target = await readFigmaDraftTarget(root, scope, screen ?? null);
      if (target === null) {
        throw new KotikitError(
          "This screen needs a Figma draft page before I can create a design plan.",
          `Ask the designer for the exact Figma draft page link, then call kotikit_figma_target_bind.`
        );
      }

      // Determine kind based on whether plan already exists
      const existing = await readDesignPlan(root, scope, screen ?? null);
      const kind: "create" | "update" = existing ? "update" : "create";

      // Generate plan
      const plan = generateDesignPlan({
        scope,
        screen: screen ?? null,
        spec,
        flowManifest,
        config,
        target,
      });

      // Write plan
      const path = await writeDesignPlan(root, scope, screen ?? null, plan);

      // Auto-commit. We want subject:
      //   feat(spec): create design plan <scope>          (single)
      //   feat(spec): create design plan <scope>/<screen>  (multi)
      //
      // autoCommit builds: feat(${scopePrefix}): ${kind} ${scope}${suffix}
      // So pass scope="design plan <scope>" and suffix="/<screen>" (or "")
      const subjectScopeStr = `design plan ${scope}`;
      const subjectSuffix = screen ? `/${screen}` : "";
      const commitResult = await autoCommit({
        root,
        scope: subjectScopeStr,
        kind,
        files: [path],
        enabled: config.git.autoCommit,
        coAuthor: config.git.coAuthor,
        subjectScope: "spec",
        subjectSuffix,
      });

      return toolText(
        `Design plan written. ${plan.steps.length} steps for ${plan.pageName}. ${commitResult.committed ? commitResult.message : "(not committed)"}`,
        { planPath: path, plan, commit: commitResult }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}

// Ensure designPlanPath is referenced to satisfy noUnusedLocals
void (designPlanPath as unknown);
