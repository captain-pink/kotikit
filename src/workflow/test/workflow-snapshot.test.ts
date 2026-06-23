import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { writeBridgeConfig } from "../../mcp/bridge/token.js";
import { writeDesignPlan } from "../../planning/design-plan-store.js";
import { EMPTY_LAYOUT_CONTRACT } from "../../planning/layout-contract.js";
import { writeScreenSpec } from "../../spec/engine.js";
import { newScreenSpec } from "../../spec/schema.js";
import { manifestPath } from "../../util/paths.js";
import { collectWorkflowSnapshot } from "../workflow-snapshot.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-workflow-snapshot-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("collectWorkflowSnapshot", () => {
  it("summarizes setup and design-system state without loading history", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    config.figma.designSystemFiles = [{ key: "FILE123", name: "DS" }];
    await writeConfig(root, config);
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_test\n");
    mkdirSync(join(root, "design-system"), { recursive: true });
    writeFileSync(manifestPath(root), '{"version":1,"files":[]}\n');

    const snapshot = await collectWorkflowSnapshot({ root });

    expect(snapshot.initialized).toBe(true);
    expect(snapshot.hasFigmaToken).toBe(true);
    expect(snapshot.figmaFilesCount).toBe(1);
    expect(snapshot.designSystem.configured).toBe(true);
    expect(snapshot.designSystem.synced).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("events");
  });

  it("captures the active screen target and unresolved component decisions", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = newScreenSpec({
      title: "Members",
      description: "Manage organization members.",
    });
    const updatedSpec = {
      ...spec,
      components: [
        { name: "Button", dsKey: "button-key" },
        { name: "Status Toggle", usage: "Toggle active status." },
        {
          name: "Invite Drawer",
          usage: "Collect invite details.",
          resolution: {
            kind: "create-draft-component" as const,
            status: "planned" as const,
            variablePolicy: "require-existing-variables" as const,
          },
        },
      ],
    };
    await writeScreenSpec(root, "members", null, updatedSpec);

    const snapshot = await collectWorkflowSnapshot({
      root,
      scope: "members",
      screen: null,
    });

    expect(snapshot.activeTarget?.specExists).toBe(true);
    expect(snapshot.activeTarget?.hasDraftTarget).toBe(false);
    expect(snapshot.activeTarget?.unresolvedComponents).toEqual(["Status Toggle"]);
    expect(snapshot.activeTarget?.componentCreationRequired).toEqual(["Invite Drawer"]);
  });

  it("reports bridge status and design apply progress compactly", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = {
      ...newScreenSpec({
        title: "Members",
        description: "Manage organization members.",
      }),
      figmaTarget: {
        fileKey: "FILE123",
        pageId: "0:1",
        pageName: "Draft Members",
        pageUrl: "https://figma.com/design/FILE123/App?node-id=0-1",
        boundAt: "2026-06-23T10:00:00.000Z",
        source: "user-url" as const,
        safety: {
          requireDraftPageName: true as const,
          allowPageCreation: false as const,
          requireKotikitSection: true as const,
        },
      },
    };
    await writeScreenSpec(root, "members", null, spec);
    await writeDesignPlan(root, "members", null, {
      version: 1,
      scope: "members",
      pageName: "Draft Members",
      states: ["default"],
      layout: EMPTY_LAYOUT_CONTRACT,
      steps: [
        { kind: "define-state-frame", state: "default", width: 1440, height: "auto" },
        {
          kind: "apply-auto-layout",
          state: "default",
          direction: "VERTICAL",
          padding: 24,
          itemSpacing: 16,
        },
      ],
      createdAt: "2026-06-23T10:00:00.000Z",
    });
    writeFileSync(
      join(root, ".kotikit/specs/members/design.apply.log"),
      '{"stepIndex":0,"outcome":"ok"}\n'
    );
    await writeBridgeConfig(root, {
      version: 1,
      port: 53124,
      token: "test-bridge-token",
      projectRoot: root,
      projectName: "app",
      startedAt: "2026-06-23T10:00:00.000Z",
    });

    const snapshot = await collectWorkflowSnapshot({
      root,
      scope: "members",
      screen: null,
      bridgeStatus: {
        running: true,
        staleConfig: false,
        projectRoot: root,
        projectName: "app",
      },
    });

    expect(snapshot.bridge.running).toBe(true);
    expect(snapshot.activeTarget?.hasDraftTarget).toBe(true);
    expect(snapshot.activeTarget?.hasDesignPlan).toBe(true);
    expect(snapshot.activeTarget?.applyProgress).toEqual({
      applied: 1,
      total: 2,
      complete: false,
    });
  });
});
