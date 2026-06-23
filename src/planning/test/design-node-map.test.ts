import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeDesignNodeMap,
  readDesignNodeMap,
  upsertDesignNodeMapEntry,
} from "../design-node-map.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-node-map-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("design node map", () => {
  it("merges entries by step index and keeps latest metadata", () => {
    const map = mergeDesignNodeMap(
      {
        version: 1,
        scope: "members",
        screen: "list",
        updatedAt: "2026-06-17T00:00:00.000Z",
        nodes: [
          {
            stepIndex: 0,
            stepKind: "define-state-frame",
            outcome: "ok",
            nodeId: "old-frame",
            nodeKind: "frame",
          },
        ],
      },
      {
        scope: "members",
        screen: "list",
        updatedAt: "2026-06-17T00:00:01.000Z",
        entry: {
          stepIndex: 0,
          stepKind: "define-state-frame",
          outcome: "ok",
          nodeId: "new-frame",
          nodeKind: "frame",
          nodeName: "Members",
        },
      }
    );

    expect(map.nodes).toHaveLength(1);
    expect(map.nodes[0]?.nodeId).toBe("new-frame");
    expect(map.nodes[0]?.nodeName).toBe("Members");
    expect(map.updatedAt).toBe("2026-06-17T00:00:01.000Z");
  });

  it("persists and reads a screen-specific map", async () => {
    const root = mkTmp();

    await upsertDesignNodeMapEntry(root, "members", "list", {
      updatedAt: "2026-06-17T00:00:00.000Z",
      figmaFileKey: "fig-file",
      page: { id: "page-1", name: "Members" },
      entry: {
        stepIndex: 2,
        stepKind: "place-component",
        outcome: "ok",
        state: "default",
        componentName: "Button",
        dsKey: "button-key",
        nodeId: "instance-1",
        nodeKind: "instance",
        nodeName: "Button",
      },
    });

    const map = await readDesignNodeMap(root, "members", "list");

    expect(map?.figmaFileKey).toBe("fig-file");
    expect(map?.page?.name).toBe("Members");
    expect(map?.nodes[0]?.componentName).toBe("Button");
    expect(map?.nodes[0]?.nodeKind).toBe("instance");
  });

  it("returns null when the map file does not exist", async () => {
    const root = mkTmp();

    expect(await readDesignNodeMap(root, "missing", null)).toBeNull();
  });

  it("does not create a map until an entry is upserted", async () => {
    const root = mkTmp();

    expect(existsSync(join(root, ".kotikit", "specs"))).toBe(false);
  });
});
