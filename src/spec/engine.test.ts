import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeScreenSpec, readScreenSpec, writeFlowManifest, readFlowManifest, listScopes, scopeExists } from "./engine";
import { readIndex } from "./index-store";
import { SCREEN_SPEC_SCHEMA_VERSION, newScreenSpec, newFlowManifest } from "./schema";
import { KotikitError } from "../util/result";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-engine-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("single-screen spec (spec.json)", () => {
  it("writes and reads back a single-screen spec", async () => {
    const spec = newScreenSpec({ title: "Profile Page", description: "Shows user profile" });
    const path = await writeScreenSpec(tmp, "profile-page", null, spec);

    expect(path.endsWith("spec.json")).toBe(true);

    const loaded = await readScreenSpec(tmp, "profile-page", null);
    expect(loaded.title).toBe("Profile Page");
    expect(loaded.id).toBe(spec.id);
  });

  it("updates index with kind=screen after write", async () => {
    const spec = newScreenSpec({ title: "Profile Page", description: "x" });
    await writeScreenSpec(tmp, "profile-page", null, spec);

    const index = await readIndex(tmp);
    expect(index).toHaveLength(1);
    expect(index[0].scope).toBe("profile-page");
    expect(index[0].kind).toBe("screen");
    expect(index[0].status).toBe("draft");
  });

  it("rewrites a legacy spec in the latest schema only when that spec is touched", async () => {
    const legacy = newScreenSpec({ title: "Legacy", description: "x" });
    const dir = join(tmp, ".kotikit", "specs", "legacy");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "spec.json");
    const { schemaVersion: _schemaVersion, ...legacyWithoutSchemaVersion } = legacy;
    writeFileSync(path, JSON.stringify(legacyWithoutSchemaVersion, null, 2) + "\n", "utf-8");

    expect(JSON.parse(readFileSync(path, "utf-8")).schemaVersion).toBeUndefined();

    const loaded = await readScreenSpec(tmp, "legacy", null);
    expect(loaded.schemaVersion).toBe(SCREEN_SPEC_SCHEMA_VERSION);
    expect(JSON.parse(readFileSync(path, "utf-8")).schemaVersion).toBeUndefined();

    loaded.title = "Legacy Updated";
    await writeScreenSpec(tmp, "legacy", null, loaded);

    const written = JSON.parse(readFileSync(path, "utf-8")) as { schemaVersion?: number; title?: string };
    expect(written.schemaVersion).toBe(SCREEN_SPEC_SCHEMA_VERSION);
    expect(written.title).toBe("Legacy Updated");
  });
});

describe("multi-screen flow", () => {
  it("writes and reads back a flow manifest", async () => {
    const manifest = newFlowManifest({
      title: "Checkout Flow",
      description: "Full purchase",
      screens: [
        { id: "cart", path: "cart.spec.json", title: "Cart" },
        { id: "shipping", path: "shipping.spec.json", title: "Shipping" },
      ],
    });
    const path = await writeFlowManifest(tmp, "checkout-flow", manifest);

    expect(path.endsWith("flow.json")).toBe(true);

    const loaded = await readFlowManifest(tmp, "checkout-flow");
    expect(loaded.title).toBe("Checkout Flow");
    expect(loaded.screens).toHaveLength(2);
  });

  it("writes and reads back individual screen specs", async () => {
    const cart = newScreenSpec({ title: "Cart", description: "Shows cart", flowRef: "checkout-flow/flow.json" });
    const shipping = newScreenSpec({ title: "Shipping", description: "Shipping form", flowRef: "checkout-flow/flow.json" });

    await writeScreenSpec(tmp, "checkout-flow", "cart", cart);
    await writeScreenSpec(tmp, "checkout-flow", "shipping", shipping);

    const loadedCart = await readScreenSpec(tmp, "checkout-flow", "cart");
    const loadedShipping = await readScreenSpec(tmp, "checkout-flow", "shipping");

    expect(loadedCart.title).toBe("Cart");
    expect(loadedCart.flowRef).toBe("checkout-flow/flow.json");
    expect(loadedShipping.title).toBe("Shipping");
  });

  it("index reflects screens after writing manifest + screen specs", async () => {
    const manifest = newFlowManifest({
      title: "Checkout",
      description: "desc",
      screens: [
        { id: "cart", path: "cart.spec.json", title: "Cart" },
        { id: "shipping", path: "shipping.spec.json", title: "Shipping" },
      ],
    });
    await writeFlowManifest(tmp, "checkout-flow", manifest);

    const index = await readIndex(tmp);
    expect(index[0].kind).toBe("flow");
    expect(index[0].screens).toContain("cart");
    expect(index[0].screens).toContain("shipping");
  });
});

describe("error cases", () => {
  it("readScreenSpec throws KotikitError for missing scope", async () => {
    try {
      await readScreenSpec(tmp, "nonexistent", null);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof KotikitError).toBe(true);
      expect((e as KotikitError).userMessage).toContain("nonexistent");
    }
  });

  it("readFlowManifest throws KotikitError for missing flow", async () => {
    try {
      await readFlowManifest(tmp, "nonexistent-flow");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof KotikitError).toBe(true);
      expect((e as KotikitError).userMessage).toContain("nonexistent-flow");
    }
  });
});

describe("listScopes / scopeExists", () => {
  it("listScopes returns empty before any writes", async () => {
    const list = await listScopes(tmp);
    expect(list).toHaveLength(0);
  });

  it("listScopes returns entries after writes", async () => {
    const spec = newScreenSpec({ title: "Profile", description: "x" });
    await writeScreenSpec(tmp, "profile-page", null, spec);
    const list = await listScopes(tmp);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Profile");
  });

  it("scopeExists returns false before write", async () => {
    expect(await scopeExists(tmp, "missing")).toBe(false);
  });

  it("scopeExists returns true after write", async () => {
    const spec = newScreenSpec({ title: "Profile", description: "x" });
    await writeScreenSpec(tmp, "profile-page", null, spec);
    expect(await scopeExists(tmp, "profile-page")).toBe(true);
  });
});
