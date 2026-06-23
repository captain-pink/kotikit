import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter } from "./adapter.js";
import { verifyGateEnvironment } from "./environment.js";
import { reactAdapter } from "./react/adapter.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-env-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function seedBins(root: string, tools: string[]) {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  for (const t of tools) writeFileSync(join(bin, t), "#!/bin/sh\n");
}

describe("verifyGateEnvironment", () => {
  it("returns ok when all tools are present (vitest)", async () => {
    const root = mkTmp();
    seedBins(root, ["tsc", "eslint", "prettier", "vitest"]);
    const report = await verifyGateEnvironment({
      root,
      adapter: reactAdapter,
      testFramework: "vitest",
    });
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("returns ok when tools present and testFramework=none", async () => {
    const root = mkTmp();
    seedBins(root, ["tsc", "eslint", "prettier"]);
    const report = await verifyGateEnvironment({
      root,
      adapter: reactAdapter,
      testFramework: "none",
    });
    expect(report.ok).toBe(true);
  });

  it("lists all four missing gates with install hints (vitest)", async () => {
    const root = mkTmp();
    const report = await verifyGateEnvironment({
      root,
      adapter: reactAdapter,
      testFramework: "vitest",
    });
    expect(report.ok).toBe(false);
    expect(report.missing.map((m) => m.gate).sort()).toEqual([
      "eslint",
      "prettier",
      "tsc",
      "vitest",
    ]);
    for (const m of report.missing) {
      expect(m.hint).toMatch(/bun add -d/);
    }
  });

  it("hints mention the relevant tool", async () => {
    const root = mkTmp();
    const report = await verifyGateEnvironment({
      root,
      adapter: reactAdapter,
      testFramework: "vitest",
    });
    if (report.ok) throw new Error("expected missing tools");
    const byGate: Record<string, string> = {};
    for (const m of report.missing) byGate[m.gate] = m.hint;
    expect(byGate.tsc).toContain("typescript");
    expect(byGate.eslint).toContain("eslint");
    expect(byGate.prettier).toContain("prettier");
    expect(byGate.vitest).toContain("vitest");
  });

  it("does not include vitest when testFramework=none", async () => {
    const root = mkTmp();
    seedBins(root, ["tsc", "eslint"]); // prettier missing too
    const report = await verifyGateEnvironment({
      root,
      adapter: reactAdapter,
      testFramework: "none",
    });
    expect(report.ok).toBe(false);
    expect(report.missing.map((m) => m.gate)).toEqual(["prettier"]);
    expect(report.missing.find((m) => m.gate === "vitest")).toBeUndefined();
  });

  it("works with a stub adapter", async () => {
    const stub: Adapter = {
      name: "stub",
      systemPrompt: () => "",
      importStatement: (n) => n,
      fileNameFor: (n, k) => (k === "component" ? `${n}.tsx` : `${n}.test.tsx`),
      testScaffold: () => "",
      qualityGates: () => [],
      verifyEnvironment: async () =>
        ({ ok: false, missing: ["tsc", "eslint"] as const }) as {
          ok: false;
          missing: ("tsc" | "eslint" | "prettier" | "vitest")[];
        },
      transformGateOutput: () => ({ failures: [] }),
    };
    const report = await verifyGateEnvironment({
      root: "/tmp/x",
      adapter: stub,
      testFramework: "vitest",
    });
    expect(report.ok).toBe(false);
    expect(report.missing.map((m) => m.gate)).toEqual(["tsc", "eslint"]);
  });
});
