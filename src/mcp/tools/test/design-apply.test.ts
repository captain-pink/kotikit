import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { FigmaDraftTarget } from "../../../figma/draft-target.js";
import { writeScreenSpec } from "../../../spec/engine.js";
import { newScreenSpec } from "../../../spec/schema.js";
import { designApplyLogPath, designNodeMapPath } from "../../../util/paths.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerDesignApplyTools } from "../design-apply.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-design-apply-"));
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
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
}

const target = (): FigmaDraftTarget => ({
  fileKey: "fig-file",
  pageId: "page-1",
  pageName: "Draft - Cart",
  pageUrl: "https://www.figma.com/design/fig-file/App?node-id=page-1",
  boundAt: "2026-06-22T00:00:00.000Z",
  source: "user-url",
  section: { id: "section-1", name: "kotikit / checkout-flow / cart / 2026-06-22" },
  safety: {
    requireDraftPageName: true,
    allowPageCreation: false,
    requireKotikitSection: true,
  },
});

const seedTargetSpec = async (
  root: string,
  scope = "checkout-flow",
  screen: string | null = "cart"
): Promise<void> => {
  const spec = newScreenSpec({ title: "Cart", description: "Cart" });
  spec.figmaTarget = target();
  await writeScreenSpec(root, scope, screen, spec);
};

describe("kotikit_design_apply_step", () => {
  it("describes itself as an official Figma MCP apply recorder", () => {
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(mkTmp()));
    const tool = registry.tools.find((entry) => entry.name === "kotikit_design_apply_step");

    expect(tool?.description).toContain("official Figma MCP");
    expect(tool?.description).not.toContain("plugin");
  });

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
      scope: "cart",
      stepIndex: 0,
      outcome: "ok",
    });
    expect(result.isError).toBeFalsy();
    expect(existsSync(designApplyLogPath(root, "cart", null))).toBe(true);
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain('"outcome":"ok"');
    expect(log).toContain('"stepIndex":0');
  });

  it("records 'warned' outcome with a note", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 2,
      outcome: "warned",
      note: "dsKey missing",
    });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain('"outcome":"warned"');
    expect(log).toContain('"note":"dsKey missing"');
  });

  it("records 'failed' outcome", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 5,
      outcome: "failed",
    });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    expect(log).toContain('"outcome":"failed"');
  });

  it("appends multiple lines (JSONL)", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 0,
      outcome: "ok",
    });
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 1,
      outcome: "ok",
    });
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 2,
      outcome: "ok",
    });

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
      scope: "checkout-flow",
      screen: "cart",
      stepIndex: 0,
      outcome: "ok",
    });
    expect(existsSync(designApplyLogPath(root, "checkout-flow", "cart"))).toBe(true);
    expect(existsSync(designApplyLogPath(root, "checkout-flow", null))).toBe(false);
  });

  it("each line is valid JSON with ts/stepIndex/outcome fields", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_design_apply_step", {
      scope: "cart",
      stepIndex: 7,
      outcome: "ok",
    });
    const log = readFileSync(designApplyLogPath(root, "cart", null), "utf-8");
    const parsed = JSON.parse(log.trim());
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.stepIndex).toBe(7);
    expect(parsed.outcome).toBe("ok");
  });

  it("updates the design node map when Figma node metadata is provided", async () => {
    const root = mkTmp();
    await seedTargetSpec(root);
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
      figmaPageName: "Draft - Cart",
      figmaPageUrl: "https://www.figma.com/design/fig-file/App?node-id=page-1",
      figmaSectionId: "section-1",
      figmaSectionName: "kotikit / checkout-flow / cart / 2026-06-22",
      figmaNodeId: "instance-1",
      figmaNodeKind: "instance",
      figmaNodeName: "Button",
    });

    const map = JSON.parse(readFileSync(designNodeMapPath(root, "checkout-flow", "cart"), "utf-8"));
    expect(map.figmaFileKey).toBe("fig-file");
    expect(map.target.pageUrl).toBe("https://www.figma.com/design/fig-file/App?node-id=page-1");
    expect(map.page.name).toBe("Draft - Cart");
    expect(map.section.name).toBe("kotikit / checkout-flow / cart / 2026-06-22");
    expect(map.nodes[0].nodeId).toBe("instance-1");
    expect(map.nodes[0].componentName).toBe("Button");
  });

  it("rejects node metadata that points to a different Figma file", async () => {
    const root = mkTmp();
    await seedTargetSpec(root);
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));

    const result = await callTool(registry, "kotikit_design_apply_step", {
      scope: "checkout-flow",
      screen: "cart",
      stepIndex: 2,
      stepKind: "place-component",
      outcome: "ok",
      figmaFileKey: "other-file",
      figmaPageId: "page-1",
      figmaPageName: "Draft - Cart",
      figmaNodeId: "instance-1",
      figmaNodeKind: "instance",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("different Figma file");
    expect(existsSync(designNodeMapPath(root, "checkout-flow", "cart"))).toBe(false);
  });

  it("rejects node metadata that points outside the bound draft page", async () => {
    const root = mkTmp();
    await seedTargetSpec(root);
    const registry = makeRegistry();
    registerDesignApplyTools(registry, makeCtx(root));

    const result = await callTool(registry, "kotikit_design_apply_step", {
      scope: "checkout-flow",
      screen: "cart",
      stepIndex: 2,
      stepKind: "place-component",
      outcome: "ok",
      figmaFileKey: "fig-file",
      figmaPageId: "other-page",
      figmaPageName: "Draft - Other",
      figmaNodeId: "instance-1",
      figmaNodeKind: "instance",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bound draft page");
    expect(existsSync(designNodeMapPath(root, "checkout-flow", "cart"))).toBe(false);
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
