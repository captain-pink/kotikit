import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerDesignApplyTools } from "./design-apply.js";
import { designApplyLogPath } from "../../util/paths.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-design-apply-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

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

describe("kotikit_design_apply_step", () => {
  it("records 'ok' outcome", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart", stepIndex: 0, outcome: "ok",
    });
    expect(result.isError).toBeFalsy();
    expect(existsSync(designApplyLogPath(root, "cart", null))).toBe(true);
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain("\"outcome\":\"ok\"");
    expect(log).toContain("\"stepIndex\":0");
  });

  it("records 'warned' outcome with a note", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart", stepIndex: 2, outcome: "warned", note: "dsKey missing",
    });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain("\"outcome\":\"warned\"");
    expect(log).toContain("\"note\":\"dsKey missing\"");
  });

  it("records 'failed' outcome", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart", stepIndex: 5, outcome: "failed",
    });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain("\"outcome\":\"failed\"");
  });

  it("appends multiple lines (JSONL)", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", { scope: "cart", stepIndex: 0, outcome: "ok" });
    await callTool(registry, "kotikit_design_apply_step", { scope: "cart", stepIndex: 1, outcome: "ok" });
    await callTool(registry, "kotikit_design_apply_step", { scope: "cart", stepIndex: 2, outcome: "ok" });

    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("multi-screen scope writes to <screen>.design.apply.log", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "checkout-flow", screen: "cart", stepIndex: 0, outcome: "ok",
    });
    expect(existsSync(designApplyLogPath(root, "checkout-flow", "cart"))).toBe(true);
    expect(existsSync(designApplyLogPath(root, "checkout-flow", null))).toBe(false);
  });

  it("each line is valid JSON with ts/stepIndex/outcome fields", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", { scope: "cart", stepIndex: 7, outcome: "ok" });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    const parsed = JSON.parse(log.trim());
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.stepIndex).toBe(7);
    expect(parsed.outcome).toBe("ok");
  });
});
