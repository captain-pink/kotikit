import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { z } from "zod";
import { defaultConfig } from "../../config/schema.js";
import { readScreenSpec, writeScreenSpec } from "../../spec/engine.js";
import { generateComponentPlan } from "../../planning/component-planner.js";
import {
  readComponentPlan,
  writeComponentPlan,
} from "../../planning/component-plan-store.js";
import { readVariablesJson } from "../../sync/variable-resolver.js";
import { autoCommit } from "../../git/auto-commit.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";

const ComponentPlanCreateArgsSchema = z.object({
  scope: z.string().min(1),
  screen: z.string().min(1).optional(),
  components: z.array(z.string().min(1)).optional(),
  mode: z.enum(["create-draft-components", "inline-draft"]),
  allowLiteralFallback: z.boolean().optional(),
});

const parseComponentPlanArgs = (args: unknown): z.infer<typeof ComponentPlanCreateArgsSchema> => {
  const result = ComponentPlanCreateArgsSchema.safeParse(args);
  if (result.success) return result.data;
  const fields = result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ");
  throw new KotikitError(
    "The component plan request is missing required information.",
    `Check these fields: ${fields}.`
  );
};

export function registerComponentPlanTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registry.tools.push({
    name: "kotikit_component_plan_create",
    description:
      "Plan how missing screen components should be resolved before Figma design creation continues.",
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
        components: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional unresolved component names to plan. Omit to plan every unresolved component in the spec.",
        },
        mode: {
          type: "string",
          enum: ["create-draft-components", "inline-draft"],
          description:
            "Create reusable draft components first, or build missing pieces inline in this page only.",
        },
        allowLiteralFallback: {
          type: "boolean",
          description:
            "Set true only after the user explicitly accepts hardcoded literals because variables are unavailable.",
        },
      },
      required: ["scope", "mode"],
    },
  } satisfies Tool);

  registry.handlers.set("kotikit_component_plan_create", async (args) => {
    try {
      const { root } = ctx;
      const parsed = parseComponentPlanArgs(args);
      const screenSlug = parsed.screen ?? null;
      const config = (await ctx.loadConfig()) ?? defaultConfig();
      const spec = await readScreenSpec(root, parsed.scope, screenSlug);
      const variables = await readVariablesJson(root);
      const existingPlan = await readComponentPlan(root, parsed.scope, screenSlug);

      const { plan, updatedSpec } = generateComponentPlan({
        scope: parsed.scope,
        screen: screenSlug,
        spec,
        mode: parsed.mode,
        variables,
        componentNames: parsed.components,
        allowLiteralFallback: parsed.allowLiteralFallback,
      });

      const specPath = await writeScreenSpec(root, parsed.scope, screenSlug, updatedSpec);
      const planPath = await writeComponentPlan(root, parsed.scope, screenSlug, plan);
      const commitResult = await autoCommit({
        root,
        scope: `component plan ${parsed.scope}`,
        kind: existingPlan === null ? "create" : "update",
        files: [specPath, planPath],
        enabled: config.git.autoCommit,
        coAuthor: config.git.coAuthor,
        subjectScope: "spec",
        subjectSuffix: parsed.screen ? `/${parsed.screen}` : "",
      });

      return toolText(
        `Component plan written. ${plan.steps.length} missing component(s) planned. ${commitResult.committed ? commitResult.message : "(not committed)"}`,
        {
          planPath,
          specPath,
          plan,
          commit: commitResult,
        }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
