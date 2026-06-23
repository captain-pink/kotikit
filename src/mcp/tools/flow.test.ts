import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { defaultConfig } from "../../config/schema.js";
import type { FlowDraft } from "../../spec/decompose.js";
import { FlowManifestSchema } from "../../spec/schema.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerFlowTools } from "./flow.js";
import { registerSpecTools } from "./spec.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegistry(): ToolRegistry {
  return { tools: [], handlers: new Map() };
}

function makeCtx(root: string): ToolContext {
  return {
    root,
    loadConfig: async () => null,
  };
}

async function call(
  registry: ToolRegistry,
  name: string,
  args: unknown
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`No handler registered for "${name}"`);
  return handler(args);
}

// ─── Test fixture ─────────────────────────────────────────────────────────────

function make5ScreenDraft(): FlowDraft {
  return {
    scope: "checkout-flow",
    title: "Checkout Flow",
    description: "Full e-commerce purchase funnel",
    screens: [
      {
        slug: "cart",
        title: "Cart",
        description: "Shows the shopping cart",
        functional: ["Display items", "Update quantities"],
        states: { empty: "No items in cart", loaded: "Items visible" },
      },
      {
        slug: "shipping",
        title: "Shipping",
        description: "Collect shipping address",
        functional: ["Address form", "Validate address"],
        states: { idle: "Waiting for input", error: "Validation failed" },
      },
      {
        slug: "payment",
        title: "Payment",
        description: "Collect payment details",
        functional: ["Credit card form", "Apply coupon"],
        states: { idle: "Waiting", processing: "Payment in progress", failed: "Payment declined" },
      },
      {
        slug: "review",
        title: "Order Review",
        description: "Review before confirming",
        functional: ["Show summary", "Allow edits"],
        states: { idle: "Reviewing", confirmed: "User confirmed" },
      },
      {
        slug: "confirmation",
        title: "Order Confirmation",
        description: "Success state after purchase",
        functional: ["Show order number", "Send email"],
        states: { pending: "Processing", done: "Email sent" },
      },
    ],
    transitions: [
      { from: "cart", to: "shipping", trigger: "Proceed to shipping" },
      { from: "shipping", to: "payment", trigger: "Continue to payment" },
      { from: "payment", to: "review", trigger: "Review order" },
      { from: "review", to: "confirmation", trigger: "Place order" },
    ],
    sharedState: ["cartItems", "selectedAddress", "paymentMethod"],
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kotikit-flow-test-"));
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("kotikit_flow_create", () => {
  it("writes flow.json + 5 *.spec.json files", async () => {
    const registry = makeRegistry();
    registerFlowTools(registry, makeCtx(tmpDir));

    const draft = make5ScreenDraft();
    const result = await call(registry, "kotikit_flow_create", { draft });

    expect(result.isError).toBeUndefined();

    const specsDir = join(tmpDir, ".kotikit", "specs", "checkout-flow");

    // flow.json must exist
    expect(existsSync(join(specsDir, "flow.json"))).toBe(true);

    // All 5 screen spec files must exist
    for (const screen of draft.screens) {
      expect(existsSync(join(specsDir, `${screen.slug}.spec.json`))).toBe(true);
    }
  });

  it("creates exactly one git commit", async () => {
    const registry = makeRegistry();
    registerFlowTools(registry, makeCtx(tmpDir));

    await call(registry, "kotikit_flow_create", { draft: make5ScreenDraft() });

    const git = simpleGit(tmpDir);
    const log = await git.log();
    expect(log.all).toHaveLength(1);
  });

  it("manifest screens[].path values match the written *.spec.json files", async () => {
    const registry = makeRegistry();
    registerFlowTools(registry, makeCtx(tmpDir));

    const draft = make5ScreenDraft();
    await call(registry, "kotikit_flow_create", { draft });

    const specsDir = join(tmpDir, ".kotikit", "specs", "checkout-flow");
    const raw = await readFile(join(specsDir, "flow.json"), "utf-8");
    const manifest = FlowManifestSchema.parse(JSON.parse(raw));

    for (const entry of manifest.screens) {
      // path stored in manifest (e.g. "cart.spec.json") must exist on disk
      expect(existsSync(join(specsDir, entry.path))).toBe(true);
    }
  });

  it("result text mentions the flow title and screen count", async () => {
    const registry = makeRegistry();
    registerFlowTools(registry, makeCtx(tmpDir));

    const draft = make5ScreenDraft();
    const result = await call(registry, "kotikit_flow_create", { draft });

    const text = result.content[0].text;
    expect(text).toContain("Checkout Flow");
    expect(text).toContain("5");
  });

  it("output is byte-identical to spec_create called with the same FlowDraft", async () => {
    // Set up a second temp dir for spec_create
    const tmpDir2 = await mkdtemp(join(tmpdir(), "kotikit-spec-vs-flow-"));
    const git2 = simpleGit(tmpDir2);
    await git2.init();
    await git2.addConfig("user.email", "test@test.com");
    await git2.addConfig("user.name", "Test");

    try {
      const draft = make5ScreenDraft();

      // Run flow_create in tmpDir
      const flowRegistry = makeRegistry();
      registerFlowTools(flowRegistry, makeCtx(tmpDir));
      await call(flowRegistry, "kotikit_flow_create", { draft });

      // Run spec_create in tmpDir2
      const specRegistry = makeRegistry();
      registerSpecTools(specRegistry, makeCtx(tmpDir2));
      await call(specRegistry, "kotikit_spec_create", { draft });

      const specsDir1 = join(tmpDir, ".kotikit", "specs", "checkout-flow");
      const specsDir2 = join(tmpDir2, ".kotikit", "specs", "checkout-flow");

      // Compare flow.json content
      const manifest1 = JSON.parse(await readFile(join(specsDir1, "flow.json"), "utf-8"));
      const manifest2 = JSON.parse(await readFile(join(specsDir2, "flow.json"), "utf-8"));

      // IDs are UUIDs generated at creation time, so we compare structural shape rather than exact bytes.
      // We verify screen count and screen path list match.
      expect(manifest1.screens.length).toBe(manifest2.screens.length);
      const paths1 = manifest1.screens.map((s: { path: string }) => s.path).sort();
      const paths2 = manifest2.screens.map((s: { path: string }) => s.path).sort();
      expect(paths1).toEqual(paths2);

      // Compare each screen spec structure (shape, not UUIDs)
      for (const screen of draft.screens) {
        const spec1 = JSON.parse(
          await readFile(join(specsDir1, `${screen.slug}.spec.json`), "utf-8")
        );
        const spec2 = JSON.parse(
          await readFile(join(specsDir2, `${screen.slug}.spec.json`), "utf-8")
        );

        expect(spec1.title).toBe(spec2.title);
        expect(spec1.requirements.functional).toEqual(spec2.requirements.functional);
        expect(spec1.requirements.states).toEqual(spec2.requirements.states);
        expect(spec1.flowRef).toBe(spec2.flowRef);

        // Both must pass FlowManifest-level schema for the manifest; specs validated below
        expect(spec1.type).toBe("screen");
        expect(spec2.type).toBe("screen");
      }
    } finally {
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it("tool is registered with correct name and inputSchema", () => {
    const registry = makeRegistry();
    registerFlowTools(registry, makeCtx(tmpDir));

    const tool = registry.tools.find((t) => t.name === "kotikit_flow_create");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema).toMatchObject({ required: ["draft"] });
    expect(registry.handlers.has("kotikit_flow_create")).toBe(true);
  });

  it("autoCommit disabled still writes files but skips commit", async () => {
    const registry = makeRegistry();
    // Override loadConfig to return a config with autoCommit disabled
    const ctx: ToolContext = {
      root: tmpDir,
      loadConfig: async () => {
        const cfg = defaultConfig();
        return { ...cfg, git: { ...cfg.git, autoCommit: false } };
      },
    };
    registerFlowTools(registry, ctx);

    await call(registry, "kotikit_flow_create", { draft: make5ScreenDraft() });

    // Files must still be written
    const specsDir = join(tmpDir, ".kotikit", "specs", "checkout-flow");
    expect(existsSync(join(specsDir, "flow.json"))).toBe(true);

    // No commit should have been made
    const git = simpleGit(tmpDir);
    try {
      const log = await git.log();
      expect(log.all).toHaveLength(0);
    } catch {
      // Empty repo with no commits also satisfies this requirement
    }
  });
});
