import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerDesignScreenTools } from "./design-screen.js";
import { newScreenSpec, newFlowManifest } from "../../spec/schema.js";
import { writeScreenSpec, writeFlowManifest } from "../../spec/engine.js";
import { writeDesignPlan } from "../../planning/design-plan-store.js";
import { generateDesignPlan } from "../../planning/design-planner.js";
import { defaultConfig } from "../../config/schema.js";
import { openDesignReviewDb } from "../../db/design-review-db.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-design-screen-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}
function makeCtx(root: string): ToolContext {
  return { root, loadConfig: async () => null };
}
async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error("missing handler " + name);
  return handler(args);
}
function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
}

function seedDsComponentJson(root: string, name: string): void {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dir = `${root}/design-system/components`;
  mkdirSync(dir, { recursive: true });
  const json = {
    name,
    key: `k-${slug}`,
    fileKey: "f",
    path: `components/${slug}.json`,
    variants: [],
    properties: {},
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(json, null, 2));
}

describe("kotikit_design_get_screen", () => {
  it("happy path: returns plan + spec + dsComponents + skipped", async () => {
    const root = mkTmp();
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.components = [{ name: "Button", dsKey: "k1" }, { name: "Input" }];
    await writeScreenSpec(root, "cart", null, spec);

    seedDsComponentJson(root, "Button");
    seedDsComponentJson(root, "Input");

    const plan = generateDesignPlan({ scope: "cart", screen: null, spec, config: defaultConfig() });
    await writeDesignPlan(root, "cart", null, plan);

    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "cart" });
    expect(result.isError).toBeFalsy();
    const detail = parseDetail(result.content[0]!.text) as {
      plan: { pageName: string };
      spec: { title: string };
      dsComponents: Record<string, unknown>;
      skipped: { name: string }[];
    };
    expect(detail.plan.pageName).toBe("Cart");
    expect(detail.spec.title).toBe("Cart");
    expect(Object.keys(detail.dsComponents).sort()).toEqual(["Button", "Input"]);
    expect(detail.skipped).toHaveLength(0);
  });

  it("missing design plan: friendly error mentioning plan_design", async () => {
    const root = mkTmp();
    const spec = newScreenSpec({ title: "X", description: "x" });
    spec.requirements.states = { default: "x" };
    await writeScreenSpec(root, "x", null, spec);

    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("plan_design");
  });

  it("missing spec: friendly error", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "does-not-exist" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("couldn't find");
  });

  it("missing DS component JSON: skipped entry, no error", async () => {
    const root = mkTmp();
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.components = [{ name: "Button" }, { name: "Missing" }];
    await writeScreenSpec(root, "cart", null, spec);
    seedDsComponentJson(root, "Button");
    // Note: "Missing" JSON intentionally not seeded

    const plan = generateDesignPlan({ scope: "cart", screen: null, spec, config: defaultConfig() });
    await writeDesignPlan(root, "cart", null, plan);

    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "cart" });
    expect(result.isError).toBeFalsy();
    const detail = parseDetail(result.content[0]!.text) as {
      dsComponents: Record<string, unknown>;
      skipped: { name: string }[];
    };
    expect(detail.dsComponents.Button).toBeDefined();
    expect(detail.skipped).toHaveLength(1);
    expect(detail.skipped[0]?.name).toBe("Missing");
  });

  it("with a flow manifest: flow field is populated", async () => {
    const root = mkTmp();
    const manifest = newFlowManifest({
      title: "Checkout", description: "x",
      screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
    });
    await writeFlowManifest(root, "checkout-flow", manifest);

    const spec = newScreenSpec({ title: "Cart", description: "x", flowRef: "checkout-flow/flow.json" });
    spec.requirements.states = { default: "x" };
    await writeScreenSpec(root, "checkout-flow", "cart", spec);

    const plan = generateDesignPlan({ scope: "checkout-flow", screen: "cart", spec, config: defaultConfig() });
    await writeDesignPlan(root, "checkout-flow", "cart", plan);

    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "checkout-flow", screen: "cart" });
    expect(result.isError).toBeFalsy();
    const detail = parseDetail(result.content[0]!.text) as { flow?: { title: string } };
    expect(detail.flow?.title).toBe("Checkout");
  });

  it("includes active design preferences relevant to the scope", async () => {
    const root = mkTmp();
    const spec = newScreenSpec({ title: "Members", description: "x" });
    spec.requirements.states = { default: "x" };
    await writeScreenSpec(root, "members", null, spec);

    const plan = generateDesignPlan({ scope: "members", screen: null, spec, config: defaultConfig() });
    await writeDesignPlan(root, "members", null, plan);

    const reviewDb = openDesignReviewDb(root);
    const session = reviewDb.recordReviewSession({
      scope: "members",
      fileKey: "fig-file",
      totalFetched: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedResolved: 0,
      comments: [],
    });
    reviewDb.recordDesignAdjustment({
      sessionId: session.sessionId,
      scope: "members",
      fileKey: "fig-file",
      category: "density",
      summary: "Reduced row height.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });
    reviewDb.promotePreferenceCandidate({
      key: "tables.density.compact_rows",
      scope: "members",
      rule: "For member-management tables, prefer compact row density.",
    });

    const registry = makeRegistry();
    registerDesignScreenTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_get_screen", { scope: "members" });
    const detail = parseDetail(result.content[0]!.text) as {
      designPreferences: { key: string; rule: string }[];
    };

    expect(detail.designPreferences[0]?.key).toBe("tables.density.compact_rows");
    expect(detail.designPreferences[0]?.rule).toContain("compact row density");
  });
});
