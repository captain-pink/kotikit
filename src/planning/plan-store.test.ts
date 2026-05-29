import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeCodePlan, readCodePlan, deleteCodePlan } from "./plan-store.js";
import { codePlanPath } from "../util/paths.js";
import { generateCodePlan } from "./code-planner.js";
import { defaultConfig } from "../config/schema.js";
import { newScreenSpec } from "../spec/schema.js";
import { KotikitError } from "../util/result.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-plan-store-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function fixturePlan() {
  const spec = newScreenSpec({ title: "Cart", description: "x" });
  spec.requirements.states = { loading: "a" };
  return generateCodePlan({
    root: "/proj",
    scope: "checkout-flow",
    screen: "cart",
    spec,
    config: defaultConfig(),
  });
}

describe("plan store", () => {
  it("write then read round-trips", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    const path = await writeCodePlan(root, "checkout-flow", "cart", plan);
    expect(path).toBe(codePlanPath(root, "checkout-flow", "cart"));
    const got = await readCodePlan(root, "checkout-flow", "cart");
    expect(got).toEqual(plan);
  });

  it("readCodePlan returns null when file is missing", async () => {
    const root = mkTmp();
    expect(await readCodePlan(root, "missing", null)).toBeNull();
  });

  it("readCodePlan throws KotikitError on malformed JSON", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeCodePlan(root, "checkout-flow", "cart", plan);
    const path = codePlanPath(root, "checkout-flow", "cart");
    writeFileSync(path, "not valid json{{{");
    await expect(
      readCodePlan(root, "checkout-flow", "cart")
    ).rejects.toBeInstanceOf(KotikitError);
  });

  it("readCodePlan throws KotikitError on schema mismatch", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeCodePlan(root, "checkout-flow", "cart", plan);
    const path = codePlanPath(root, "checkout-flow", "cart");
    writeFileSync(path, JSON.stringify({ version: 999, files: [] }));
    await expect(
      readCodePlan(root, "checkout-flow", "cart")
    ).rejects.toBeInstanceOf(KotikitError);
  });

  it("deleteCodePlan removes the file", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeCodePlan(root, "checkout-flow", "cart", plan);
    await deleteCodePlan(root, "checkout-flow", "cart");
    expect(await readCodePlan(root, "checkout-flow", "cart")).toBeNull();
  });

  it("deleteCodePlan is a no-op when file is absent", async () => {
    const root = mkTmp();
    await deleteCodePlan(root, "missing", null); // should not throw
    expect(await readCodePlan(root, "missing", null)).toBeNull();
  });

  it("write uses .code.plan.json for multi-screen and code.plan.json for single-screen", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    // Multi-screen
    const pMulti = await writeCodePlan(root, "checkout-flow", "cart", plan);
    expect(pMulti).toMatch(/cart\.code\.plan\.json$/);
    // Single-screen — same plan body, different scope name
    const pSingle = await writeCodePlan(root, "profile-page", null, plan);
    expect(pSingle).toMatch(/code\.plan\.json$/);
    expect(pSingle).not.toMatch(/\.code\.plan\.json$/);
  });
});
