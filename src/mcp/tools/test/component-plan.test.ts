import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import { writeConfig } from "../../../config/load.js";
import { defaultConfig } from "../../../config/schema.js";
import { readComponentPlan } from "../../../planning/component-plan-store.js";
import { readScreenSpec, writeScreenSpec } from "../../../spec/engine.js";
import { newScreenSpec } from "../../../spec/schema.js";
import { writeVariablesJson } from "../../../sync/variables.js";
import { componentPlanPath } from "../../../util/paths.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerComponentPlanTools } from "../component-plan.js";

const roots: string[] = [];

const mkRoot = async (): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), "kotikit-component-plan-"));
  roots.push(root);
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  await writeConfig(root, defaultConfig());
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (root: string): ToolContext => ({
  root,
  loadConfig: async () => {
    const { loadConfig } = await import("../../../config/load.js");
    return loadConfig(root);
  },
});

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
};

const seedSpec = async (root: string): Promise<void> => {
  const spec = newScreenSpec({ title: "Members", description: "Members table." });
  spec.requirements.states = { default: "Loaded" };
  spec.components = [
    { name: "Button", dsKey: "button-key" },
    { name: "Member status toggle", usage: "Toggle a row active/inactive" },
  ];
  await writeScreenSpec(root, "members", null, spec);
};

const seedVariables = async (root: string): Promise<void> => {
  await writeVariablesJson(root, {
    version: 1,
    collisions: [],
    entries: [
      {
        name: "color/primary",
        kind: "color",
        source: "variable",
        value: "#0055ff",
        key: "color-primary-key",
        id: "color-primary-id",
      },
      {
        name: "space/4",
        kind: "spacing",
        source: "variable",
        value: 16,
        id: "space-4-id",
      },
    ],
  });
};

describe("kotikit_component_plan_create", () => {
  it("blocks component creation when variables are unavailable and literal fallback was not approved", async () => {
    const root = await mkRoot();
    await seedSpec(root);

    const registry = makeRegistry();
    registerComponentPlanTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_component_plan_create", {
      scope: "members",
      mode: "create-draft-components",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("sync variables through the kotikit Figma plugin");
    expect(existsSync(componentPlanPath(root, "members", null))).toBe(false);
  });

  it("creates a reusable draft component plan and updates the spec when variables are available", async () => {
    const root = await mkRoot();
    await seedSpec(root);
    await seedVariables(root);

    const registry = makeRegistry();
    registerComponentPlanTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_component_plan_create", {
      scope: "members",
      mode: "create-draft-components",
    });
    const plan = await readComponentPlan(root, "members", null);
    const spec = await readScreenSpec(root, "members", null);

    expect(result.isError).toBeFalsy();
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]).toMatchObject({
      kind: "create-draft-component",
      componentName: "Member status toggle",
      variablePolicy: "require-existing-variables",
    });
    expect(plan?.steps[0]?.tokenRefs.map((token) => token.name)).toContain("color/primary");
    expect(spec.components[1]?.resolution).toMatchObject({
      kind: "create-draft-component",
      status: "planned",
      componentSpecRef: "components/member-status-toggle.component.json",
    });
  });

  it("records inline fallback only when the designer explicitly approved literals", async () => {
    const root = await mkRoot();
    await seedSpec(root);

    const registry = makeRegistry();
    registerComponentPlanTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_component_plan_create", {
      scope: "members",
      mode: "inline-draft",
      allowLiteralFallback: true,
    });
    const plan = await readComponentPlan(root, "members", null);
    const spec = await readScreenSpec(root, "members", null);

    expect(result.isError).toBeFalsy();
    expect(plan?.literalFallbackAllowed).toBe(true);
    expect(plan?.steps[0]).toMatchObject({
      kind: "create-inline-draft",
      componentName: "Member status toggle",
      variablePolicy: "allow-literals-after-user-confirmation",
    });
    expect(spec.components[1]?.resolution).toEqual({
      kind: "inline-draft",
      status: "approved",
      variablePolicy: "allow-literals-after-user-confirmation",
    });
  });
});
