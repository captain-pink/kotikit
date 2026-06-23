import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { writeConfig } from "../../../config/load.js";
import { defaultConfig } from "../../../config/schema.js";
import { CodePlanSchema } from "../../../planning/code-plan-schema.js";
import { writeFlowManifest, writeScreenSpec } from "../../../spec/engine.js";
import { newFlowManifest, newScreenSpec } from "../../../spec/schema.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerPlanCodeTools } from "../plan-code.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-plan-code-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}

function makeCtx(root: string, configOverride?: ReturnType<typeof defaultConfig>): ToolContext {
  return { root, loadConfig: async () => configOverride ?? null };
}

async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
}

describe("kotikit_plan_code", () => {
  it("single-screen: writes <scope>/code.plan.json", async () => {
    const root = mkTmp();
    const spec = newScreenSpec({ title: "Profile Page", description: "User profile." });
    spec.requirements.states = { loading: "a", empty: "b", error: "c", filled: "d" };
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanCodeTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_code", { scope: "profile-page" });
    expect(result.isError).toBeFalsy();
    expect(existsSync(`${root}/.kotikit/specs/profile-page/code.plan.json`)).toBe(true);
    const plan = CodePlanSchema.parse(
      JSON.parse(readFileSync(`${root}/.kotikit/specs/profile-page/code.plan.json`, "utf-8"))
    );
    expect(plan.componentName).toBe("ProfilePage");
  });

  it("multi-screen: writes <scope>/<screen>.code.plan.json", async () => {
    const root = mkTmp();
    const manifest = newFlowManifest({
      title: "Checkout",
      description: "x",
      screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
    });
    await writeFlowManifest(root, "checkout-flow", manifest);
    const spec = newScreenSpec({
      title: "Cart",
      description: "y",
      flowRef: "checkout-flow/flow.json",
    });
    spec.requirements.states = { loading: "a" };
    await writeScreenSpec(root, "checkout-flow", "cart", spec);

    const registry = makeRegistry();
    registerPlanCodeTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_code", {
      scope: "checkout-flow",
      screen: "cart",
    });
    expect(result.isError).toBeFalsy();
    expect(existsSync(`${root}/.kotikit/specs/checkout-flow/cart.code.plan.json`)).toBe(true);
  });

  it("missing spec: friendly error", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerPlanCodeTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_code", {
      scope: "does-not-exist",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("couldn't find");
  });

  it("respects tests: false config (no testPath in plan)", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.project.tests = false;
    await writeConfig(root, cfg);

    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = {};
    await writeScreenSpec(root, "x", null, spec);

    const registry = makeRegistry();
    registerPlanCodeTools(registry, { root, loadConfig: async () => cfg });
    const result = await callTool(registry, "kotikit_plan_code", { scope: "x" });
    expect(result.isError).toBeFalsy();
    const plan = CodePlanSchema.parse(
      JSON.parse(readFileSync(`${root}/.kotikit/specs/x/code.plan.json`, "utf-8"))
    );
    expect(plan.testPath).toBeUndefined();
  });
});
