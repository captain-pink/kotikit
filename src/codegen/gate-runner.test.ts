import { describe, it, expect } from "bun:test";
import { runGates, type SpawnFn } from "./gate-runner.js";
import { reactAdapter } from "./react/adapter.js";
import { defaultConfig } from "../config/schema.js";
import { newScreenSpec } from "../spec/schema.js";
import type { AdapterContext } from "./adapter.js";

function makeCtx(): AdapterContext {
  return {
    root: "/tmp/proj",
    config: defaultConfig(),
    spec: newScreenSpec({ title: "Cart", description: "x" }),
    dsComponents: {},
  };
}

/** Build a spawn stub that responds based on command name. */
function makeStub(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>
): SpawnFn {
  return async (cmd) => {
    // Match by the tool name ("tsc", "eslint", "prettier", "vitest") — bunx --no-install <tool> ...
    const tool =
      cmd.find((c) => ["tsc", "eslint", "prettier", "vitest"].includes(c)) ?? cmd[0]!;
    const r = responses[tool] ?? { exitCode: 1, stderr: "no fixture" };
    return {
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exitCode: r.exitCode,
      timedOut: false,
    };
  };
}

describe("runGates", () => {
  it("all gates pass → report.passed === true with 4 results", async () => {
    const spawn = makeStub({
      tsc: { exitCode: 0 },
      eslint: { exitCode: 0 },
      prettier: { exitCode: 0 },
      vitest: { exitCode: 0 },
    });
    const report = await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx: makeCtx(),
      files: [],
      spawn,
    });
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
    expect(report.results.every((r) => r.passed)).toBe(true);
  });

  it("one gate fails → report.passed === false with that gate's failures populated", async () => {
    const spawn = makeStub({
      tsc: { exitCode: 0 },
      eslint: {
        exitCode: 1,
        stdout:
          "/proj/Cart.tsx\n  14:3  error  Form labels must have associated controls  jsx-a11y/label-has-associated-control",
      },
      prettier: { exitCode: 0 },
      vitest: { exitCode: 0 },
    });
    const report = await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx: makeCtx(),
      files: [],
      spawn,
    });
    expect(report.passed).toBe(false);
    const eslintResult = report.results.find((r) => r.gate === "eslint");
    expect(eslintResult?.passed).toBe(false);
    expect(eslintResult?.failures.length).toBeGreaterThan(0);
  });

  it("only: ['tsc'] runs only tsc", async () => {
    let calls = 0;
    const spawn: SpawnFn = async (cmd) => {
      calls++;
      const tool = cmd.find((c) => ["tsc", "eslint", "prettier", "vitest"].includes(c));
      expect(tool).toBe("tsc");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    };
    const report = await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx: makeCtx(),
      files: [],
      only: ["tsc"],
      spawn,
    });
    expect(calls).toBe(1);
    expect(report.results).toHaveLength(1);
  });

  it("tsc is invoked without file arguments; other gates receive the file list", async () => {
    const seen: Record<string, string[]> = {};
    const spawn: SpawnFn = async (cmd) => {
      const tool =
        cmd.find((c) => ["tsc", "eslint", "prettier", "vitest"].includes(c)) ?? "?";
      seen[tool] = cmd;
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    };
    await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx: makeCtx(),
      files: ["/tmp/proj/src/Cart.tsx", "/tmp/proj/src/Cart.test.tsx"],
      spawn,
    });
    expect(seen.tsc).toEqual(["bunx", "--no-install", "tsc", "--noEmit"]);
    expect(seen.eslint).toContain("/tmp/proj/src/Cart.tsx");
    expect(seen.prettier).toContain("/tmp/proj/src/Cart.tsx");
    expect(seen.vitest).toContain("/tmp/proj/src/Cart.test.tsx");
  });

  it("timeout: result has the timeout failure recorded", async () => {
    // A spawn that never resolves: races against the very short timeout
    const spawn: SpawnFn = () => new Promise(() => { /* never resolves */ });
    const report = await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx: makeCtx(),
      files: [],
      only: ["tsc"],
      spawn,
      timeoutMs: 50,
    });
    expect(report.results).toHaveLength(1);
    const r = report.results[0];
    expect(r?.passed).toBe(false);
    expect(r?.failures[0]?.message).toMatch(/Timed out/);
  });

  it("non-required gate (tests off) is skipped from required filter", async () => {
    const cfg = defaultConfig();
    cfg.project.testFramework = "none";
    const ctx: AdapterContext = { ...makeCtx(), config: cfg };
    const spawn = makeStub({
      tsc: { exitCode: 0 },
      eslint: { exitCode: 0 },
      prettier: { exitCode: 0 },
    });
    const report = await runGates({
      root: "/tmp/proj",
      adapter: reactAdapter,
      ctx,
      files: [],
      spawn,
    });
    expect(report.results.map((r) => r.gate)).not.toContain("vitest");
  });
});
