import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readFlowManifest,
  readScreenSpec,
  writeFlowManifest,
  writeScreenSpec,
} from "../spec/engine.js";
import { newFlowManifest, newScreenSpec } from "../spec/schema.js";
import type { FigmaDraftTarget } from "./draft-target.js";
import { readFigmaDraftTarget, writeFigmaDraftTarget } from "./draft-target-store.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-figma-target-store-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const target = (pageName = "Draft - Members"): FigmaDraftTarget => ({
  fileKey: "fig-file",
  pageId: "0:1",
  pageName,
  pageUrl: "https://www.figma.com/design/fig-file/App?node-id=0-1",
  boundAt: "2026-06-22T00:00:00.000Z",
  source: "user-url",
  section: { name: "kotikit / members / 2026-06-22" },
  safety: {
    requireDraftPageName: true,
    allowPageCreation: false,
    requireKotikitSection: true,
  },
});

describe("Figma draft target store", () => {
  it("writes and reads a single-screen target", async () => {
    const root = mkTmp();
    await writeScreenSpec(
      root,
      "members",
      null,
      newScreenSpec({
        title: "Members",
        description: "Manage members",
      })
    );

    const paths = await writeFigmaDraftTarget(root, "members", null, target());
    const updated = await readScreenSpec(root, "members", null);

    expect(paths).toHaveLength(1);
    expect(updated.figmaTarget?.pageName).toBe("Draft - Members");
    expect(await readFigmaDraftTarget(root, "members", null)).toEqual(target());
  });

  it("writes a flow-level target and uses it as a screen default", async () => {
    const root = mkTmp();
    await writeFlowManifest(
      root,
      "checkout",
      newFlowManifest({
        title: "Checkout",
        description: "Checkout flow",
        screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
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

    await writeFigmaDraftTarget(root, "checkout", null, target("Checkout Drafts"));

    expect((await readFlowManifest(root, "checkout")).figmaTarget?.pageName).toBe(
      "Checkout Drafts"
    );
    expect((await readFigmaDraftTarget(root, "checkout", "cart"))?.pageName).toBe(
      "Checkout Drafts"
    );
  });

  it("uses a screen target before a flow default", async () => {
    const root = mkTmp();
    await writeFlowManifest(
      root,
      "checkout",
      newFlowManifest({
        title: "Checkout",
        description: "Checkout flow",
        screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
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

    await writeFigmaDraftTarget(root, "checkout", null, target("Flow Drafts"));
    await writeFigmaDraftTarget(root, "checkout", "cart", target("Cart Draft"));

    expect((await readFigmaDraftTarget(root, "checkout", "cart"))?.pageName).toBe("Cart Draft");
  });
});
