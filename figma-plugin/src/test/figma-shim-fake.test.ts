import { describe, expect, it } from "bun:test";
import { FakeFigmaShim } from "../figma-shim-fake.js";

describe("FakeFigmaShim", () => {
  it("findOrCreatePage creates then returns same id", async () => {
    const shim = new FakeFigmaShim();
    const a = await shim.findOrCreatePage("Cart");
    const b = await shim.findOrCreatePage("Cart");
    expect(a.id).toBe(b.id);
  });

  it("createFrame appends to parent", async () => {
    const shim = new FakeFigmaShim();
    const page = await shim.findOrCreatePage("Cart");
    const frame = await shim.createFrame({
      name: "default",
      parentId: page.id,
      width: 1440,
      height: "auto",
    });
    const pageNode = shim.nodes.get(page.id)!;
    expect(pageNode.children).toContain(frame.id);
  });

  it("setAutoLayout records settings", async () => {
    const shim = new FakeFigmaShim();
    const page = await shim.findOrCreatePage("Cart");
    const frame = await shim.createFrame({
      name: "d",
      parentId: page.id,
      width: 100,
      height: "auto",
    });
    await shim.setAutoLayout(frame.id, { direction: "VERTICAL", padding: 24, itemSpacing: 16 });
    const node = shim.nodes.get(frame.id)!;
    expect(node.layoutMode).toBe("VERTICAL");
    expect(node.padding).toBe(24);
    expect(node.itemSpacing).toBe(16);
  });

  it("getNodeSize returns frame dimensions for layout planning", async () => {
    const shim = new FakeFigmaShim();
    const page = await shim.findOrCreatePage("Cart");
    const frame = await shim.createFrame({
      name: "d",
      parentId: page.id,
      width: 100,
      height: "auto",
    });

    expect(await shim.getNodeSize(frame.id)).toEqual({ width: 100, height: "auto" });
  });

  it("findVariableByName returns null when not seeded, id when seeded", async () => {
    const shim = new FakeFigmaShim();
    expect(await shim.findVariableByName("brand/primary")).toBeNull();
    shim.seedVariable("brand/primary", "var-1");
    expect((await shim.findVariableByName("brand/primary"))?.id).toBe("var-1");
  });

  it("notify collects messages", () => {
    const shim = new FakeFigmaShim();
    shim.notify("hello");
    shim.notify("err", { error: true });
    expect(shim.notifications).toHaveLength(2);
    expect(shim.notifications[1]?.error).toBe(true);
  });

  it("throwOn forces a method to throw", async () => {
    const shim = new FakeFigmaShim();
    shim.throwOn = { method: "importComponentByKey" };
    await expect(shim.importComponentByKey("k")).rejects.toThrow();
  });
});
