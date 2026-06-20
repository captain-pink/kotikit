import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerDesignApplyTools } from "./design-apply.js";
import { designApplyLogPath, designNodeMapPath } from "../../util/paths.js";

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
  it("advertises every design plan step kind accepted by the apply log", () => {
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(mkTmp()));
    const tool = registry.tools.find((entry) => entry.name === "kotikit_design_apply_step");
    const stepKind = tool?.inputSchema.properties?.stepKind as { enum?: string[] } | undefined;

    expect(stepKind?.enum).toContain("define-layout-zone");
  });

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

  it("updates the design node map when Figma node metadata is provided", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));

    await callTool(registry, "kotikit_design_apply_step", {
      scope: "checkout-flow",
      screen: "cart",
      stepIndex: 2,
      stepKind: "place-component",
      outcome: "ok",
      state: "default",
      componentName: "Button",
      dsKey: "button-key",
      figmaFileKey: "fig-file",
      figmaPageId: "page-1",
      figmaPageName: "Cart",
      figmaNodeId: "instance-1",
      figmaNodeKind: "instance",
      figmaNodeName: "Button",
    });

    const map = JSON.parse(
      readFileSync(designNodeMapPath(root, "checkout-flow", "cart"), "utf-8")
    );
    expect(map.figmaFileKey).toBe("fig-file");
    expect(map.page.name).toBe("Cart");
    expect(map.nodes[0].nodeId).toBe("instance-1");
    expect(map.nodes[0].componentName).toBe("Button");
  });

  it("does not write a design node map without Figma node metadata", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));

    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 0,
      stepKind: "define-state-frame",
      outcome: "ok",
    });

    expect(existsSync(designNodeMapPath(root, "cart", null))).toBe(false);
  });
});
