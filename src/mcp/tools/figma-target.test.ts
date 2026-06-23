import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import {
  readFlowManifest,
  readScreenSpec,
  writeFlowManifest,
  writeScreenSpec,
} from "../../spec/engine.js";
import { newFlowManifest, newScreenSpec } from "../../spec/schema.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerFigmaTargetTools } from "./figma-target.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-figma-target-tool-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });
const makeCtx = (root: string): ToolContext => ({
  root,
  loadConfig: () => loadConfig(root),
});

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
};

const pageClient = (name = "Draft - Members") => ({
  getNodes: async () => ({
    "0:1": {
      document: {
        id: "0:1",
        name,
        type: "CANVAS",
      },
    },
  }),
});

describe("kotikit_figma_target_bind", () => {
  it("binds a draft page URL to a single-screen spec", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    config.git.autoCommit = false;
    await writeConfig(root, config);
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_test\n");
    await writeScreenSpec(
      root,
      "members",
      null,
      newScreenSpec({
        title: "Members",
        description: "Manage members",
      })
    );

    const registry = makeRegistry();
    registerFigmaTargetTools(registry, makeCtx(root), {
      figmaClientFactory: () => pageClient(),
      now: () => "2026-06-22T10:00:00.000Z",
    });
    const result = await callTool(registry, "kotikit_figma_target_bind", {
      scope: "members",
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
    });

    const spec = await readScreenSpec(root, "members", null);
    expect(result.isError).toBeFalsy();
    expect(spec.figmaTarget?.fileKey).toBe("FILE123");
    expect(spec.figmaTarget?.pageName).toBe("Draft - Members");
    expect(spec.figmaTarget?.section?.name).toBe("kotikit / members / 2026-06-22");
  });

  it("binds a draft page URL to a flow manifest as the screen default", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    config.git.autoCommit = false;
    await writeConfig(root, config);
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_test\n");
    await writeFlowManifest(
      root,
      "checkout",
      newFlowManifest({
        title: "Checkout",
        description: "Checkout flow",
        screens: [{ id: "cart", title: "Cart", path: "cart.spec.json" }],
      })
    );
    await writeScreenSpec(
      root,
      "checkout",
      "cart",
      newScreenSpec({
        title: "Cart",
        description: "Cart screen",
      })
    );

    const registry = makeRegistry();
    registerFigmaTargetTools(registry, makeCtx(root), {
      figmaClientFactory: () => pageClient("Checkout Drafts"),
      now: () => "2026-06-22T10:00:00.000Z",
    });
    const result = await callTool(registry, "kotikit_figma_target_bind", {
      scope: "checkout",
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
    });

    const manifest = await readFlowManifest(root, "checkout");
    expect(result.isError).toBeFalsy();
    expect(manifest.figmaTarget?.pageName).toBe("Checkout Drafts");
  });

  it("returns a friendly error for non-draft page names", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    config.git.autoCommit = false;
    await writeConfig(root, config);
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_test\n");
    await writeScreenSpec(
      root,
      "members",
      null,
      newScreenSpec({
        title: "Members",
        description: "Manage members",
      })
    );

    const registry = makeRegistry();
    registerFigmaTargetTools(registry, makeCtx(root), {
      figmaClientFactory: () => pageClient("Production"),
      now: () => "2026-06-22T10:00:00.000Z",
    });
    const result = await callTool(registry, "kotikit_figma_target_bind", {
      scope: "members",
      pageUrl: "https://www.figma.com/design/FILE123/App?node-id=0-1",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Draft");
  });
});
