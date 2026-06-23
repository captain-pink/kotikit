import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { designPlanPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import type { DesignPlan } from "./design-plan-schema.js";
import { deleteDesignPlan, readDesignPlan, writeDesignPlan } from "./design-plan-store.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-design-store-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function fixturePlan(): DesignPlan {
  return {
    version: 1,
    scope: "checkout-flow",
    screen: "cart",
    pageName: "Cart",
    states: ["loading"],
    layout: {
      version: 1,
      strategy: "semantic-zones",
      zones: [],
      placements: [],
    },
    steps: [
      { kind: "define-state-frame", state: "loading", width: 1440, height: "auto" },
      {
        kind: "apply-auto-layout",
        state: "loading",
        direction: "VERTICAL",
        padding: 24,
        itemSpacing: 16,
      },
    ],
    createdAt: "2026-05-29T10:00:00.000Z",
  };
}

describe("design plan store", () => {
  it("write then read round-trips", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    const path = await writeDesignPlan(root, "checkout-flow", "cart", plan);
    expect(path).toBe(designPlanPath(root, "checkout-flow", "cart"));
    const got = await readDesignPlan(root, "checkout-flow", "cart");
    expect(got).toEqual(plan);
  });

  it("readDesignPlan returns null when file is missing", async () => {
    const root = mkTmp();
    expect(await readDesignPlan(root, "missing", null)).toBeNull();
  });

  it("readDesignPlan throws KotikitError on malformed JSON", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeDesignPlan(root, "checkout-flow", "cart", plan);
    const path = designPlanPath(root, "checkout-flow", "cart");
    writeFileSync(path, "not valid json {{{");
    await expect(readDesignPlan(root, "checkout-flow", "cart")).rejects.toBeInstanceOf(
      KotikitError
    );
  });

  it("readDesignPlan throws KotikitError on schema mismatch", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeDesignPlan(root, "checkout-flow", "cart", plan);
    const path = designPlanPath(root, "checkout-flow", "cart");
    writeFileSync(path, JSON.stringify({ version: 999 }));
    await expect(readDesignPlan(root, "checkout-flow", "cart")).rejects.toBeInstanceOf(
      KotikitError
    );
  });

  it("deleteDesignPlan removes the file", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    await writeDesignPlan(root, "checkout-flow", "cart", plan);
    await deleteDesignPlan(root, "checkout-flow", "cart");
    expect(await readDesignPlan(root, "checkout-flow", "cart")).toBeNull();
  });

  it("deleteDesignPlan is a no-op when file is absent", async () => {
    const root = mkTmp();
    await deleteDesignPlan(root, "missing", null); // should not throw
    expect(await readDesignPlan(root, "missing", null)).toBeNull();
  });

  it("multi-screen vs single-screen filename convention", async () => {
    const root = mkTmp();
    const plan = fixturePlan();
    const multi = await writeDesignPlan(root, "checkout-flow", "cart", plan);
    expect(multi).toMatch(/cart\.design\.plan\.json$/);
    const single = await writeDesignPlan(root, "profile-page", null, plan);
    expect(single).toMatch(/design\.plan\.json$/);
    expect(single).not.toMatch(/cart\.design\.plan\.json$/);
  });
});
