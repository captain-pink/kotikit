import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowDraft, SingleDraft } from "../../spec/decompose";
import { readScreenSpec } from "../../spec/engine";
import { readIndex } from "../../spec/index-store";
import type { ToolContext } from "../context";
import { registerSpecTools, type ToolRegistry } from "./spec";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmp: string;
let registry: ToolRegistry;
let ctx: ToolContext;

function makeRegistry(): ToolRegistry {
  return { tools: [], handlers: new Map() };
}

function makeCtx(root: string): ToolContext {
  return {
    root,
    loadConfig: async () => null, // will use defaultConfig (autoCommit: true)
  };
}

async function call(
  name: string,
  args: unknown
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`No handler for tool: ${name}`);
  return handler(args);
}

function getText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

// ─── Sample drafts ─────────────────────────────────────────────────────────────

const flowDraft: FlowDraft = {
  scope: "checkout-flow",
  title: "Checkout Flow",
  description: "Full purchase journey",
  screens: [
    {
      slug: "cart",
      title: "Cart",
      description: "Shopping cart",
      functional: ["Show cart items"],
      states: { empty: "No items", filled: "Has items" },
    },
    {
      slug: "shipping",
      title: "Shipping",
      description: "Shipping address form",
      functional: ["Collect shipping address"],
      states: { idle: "Waiting", submitting: "Submitting" },
    },
    {
      slug: "payment",
      title: "Payment",
      description: "Payment form",
      functional: ["Collect payment info"],
      states: { idle: "Waiting", processing: "Processing" },
    },
  ],
  transitions: [
    { from: "cart", to: "shipping", trigger: "Proceed" },
    { from: "shipping", to: "payment", trigger: "Next" },
  ],
  sharedState: ["orderId"],
};

const singleDraft: SingleDraft = {
  scope: "profile-page",
  screen: {
    slug: "profile-page",
    title: "Profile Page",
    description: "User profile screen",
    functional: ["Show user info"],
    states: { loading: "Loading", loaded: "Loaded" },
  },
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-spec-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  // Initialize a git repo so auto-commit can work
  try {
    execSync("git init && git config user.email test@test.com && git config user.name Test", {
      cwd: tmp,
      stdio: "pipe",
    });
  } catch {
    // If git fails, autoCommit will be skipped — tests still run
  }

  registry = makeRegistry();
  ctx = makeCtx(tmp);
  registerSpecTools(registry, ctx);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─── spec_create (multi-screen) ───────────────────────────────────────────────

describe("kotikit_spec_create — multi-screen flow", () => {
  it("registers the tool", () => {
    const tool = registry.tools.find((t) => t.name === "kotikit_spec_create");
    expect(tool).toBeDefined();
  });

  it("writes manifest + 3 screen specs", async () => {
    const result = await call("kotikit_spec_create", { draft: flowDraft });
    expect(result.isError).toBeUndefined();

    // All 3 specs should be readable
    const cart = await readScreenSpec(tmp, "checkout-flow", "cart");
    const shipping = await readScreenSpec(tmp, "checkout-flow", "shipping");
    const payment = await readScreenSpec(tmp, "checkout-flow", "payment");

    expect(cart.title).toBe("Cart");
    expect(shipping.title).toBe("Shipping");
    expect(payment.title).toBe("Payment");
  });

  it("each spec has flowRef set", async () => {
    await call("kotikit_spec_create", { draft: flowDraft });

    const cart = await readScreenSpec(tmp, "checkout-flow", "cart");
    expect(cart.flowRef).toBe("checkout-flow/flow.json");
  });

  it("updates index with flow entry", async () => {
    await call("kotikit_spec_create", { draft: flowDraft });

    const index = await readIndex(tmp);
    expect(index.length).toBeGreaterThan(0);
    // The flow entry should list all screen ids
    const flowEntry = index.find((e) => e.scope === "checkout-flow");
    if (flowEntry === undefined) {
      throw new Error("Expected checkout flow index entry.");
    }
    expect(flowEntry.screens).toContain("cart");
    expect(flowEntry.screens).toContain("shipping");
    expect(flowEntry.screens).toContain("payment");
  });

  it("response text mentions scope and screen count", async () => {
    const result = await call("kotikit_spec_create", { draft: flowDraft });
    const text = getText(result);
    expect(text).toContain("checkout-flow");
    expect(text).toContain("3");
  });
});

// ─── spec_create (single-screen) ─────────────────────────────────────────────

describe("kotikit_spec_create — single screen", () => {
  it("writes a single spec.json", async () => {
    const result = await call("kotikit_spec_create", { draft: singleDraft });
    expect(result.isError).toBeUndefined();

    const spec = await readScreenSpec(tmp, "profile-page", null);
    expect(spec.title).toBe("Profile Page");
    expect(spec.flowRef).toBeUndefined();
  });

  it("response text mentions scope name", async () => {
    const result = await call("kotikit_spec_create", { draft: singleDraft });
    const text = getText(result);
    expect(text).toContain("profile-page");
  });

  it("rejects malformed drafts instead of writing undefined/flow.json", async () => {
    const result = await call("kotikit_spec_create", {
      draft: {
        type: "screen",
        title: "Members",
        screens: [
          {
            slug: "members",
            title: "Members",
            description: "Members admin table",
            functional: ["Show members"],
            states: { default: "Loaded" },
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("doesn't match a kotikit draft shape");
  });
});

// ─── spec_update ─────────────────────────────────────────────────────────────

describe("kotikit_spec_update", () => {
  beforeEach(async () => {
    await call("kotikit_spec_create", { draft: singleDraft });
  });

  it("updates a field and re-read reflects it", async () => {
    const result = await call("kotikit_spec_update", {
      scope: "profile-page",
      patch: { title: "Updated Profile" },
    });
    expect(result.isError).toBeUndefined();

    const spec = await readScreenSpec(tmp, "profile-page", null);
    expect(spec.title).toBe("Updated Profile");
  });

  it("updatedAt is advanced after update", async () => {
    const before = await readScreenSpec(tmp, "profile-page", null);
    const beforeTime = before.metadata.updatedAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));

    await call("kotikit_spec_update", {
      scope: "profile-page",
      patch: { title: "Renamed" },
    });

    const after = await readScreenSpec(tmp, "profile-page", null);
    expect(after.metadata.updatedAt >= beforeTime).toBe(true);
  });

  it("rejects patch with id field", async () => {
    const result = await call("kotikit_spec_update", {
      scope: "profile-page",
      patch: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("id");
  });

  it("rejects patch with type field", async () => {
    const result = await call("kotikit_spec_update", {
      scope: "profile-page",
      patch: { type: "screen" } as Record<string, unknown>,
    });
    expect(result.isError).toBe(true);
  });

  it("response text mentions spec title", async () => {
    const result = await call("kotikit_spec_update", {
      scope: "profile-page",
      patch: { title: "Profile v2" },
    });
    const text = getText(result);
    expect(text).toContain("Profile v2");
  });
});

// ─── spec_get ─────────────────────────────────────────────────────────────────

describe("kotikit_spec_get", () => {
  beforeEach(async () => {
    await call("kotikit_spec_create", { draft: flowDraft });
  });

  it("reads a specific screen from a flow", async () => {
    const result = await call("kotikit_spec_get", {
      scope: "checkout-flow",
      screen: "cart",
    });
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain("Cart");
  });

  it("returns error when screen doesn't exist, listing real screen names", async () => {
    const result = await call("kotikit_spec_get", {
      scope: "checkout-flow",
      screen: "nonexistent-screen",
    });
    expect(result.isError).toBe(true);
    const text = getText(result);
    // Should mention the missing screen name
    expect(text).toContain("nonexistent-screen");
  });

  it("returns error with info when scope doesn't exist", async () => {
    const result = await call("kotikit_spec_get", {
      scope: "does-not-exist",
    });
    expect(result.isError).toBe(true);
  });
});

// ─── spec_list ────────────────────────────────────────────────────────────────

describe("kotikit_spec_list", () => {
  it("returns empty message before any specs", async () => {
    const result = await call("kotikit_spec_list", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain("No specs");
  });

  it("lists all scopes after creating specs", async () => {
    await call("kotikit_spec_create", { draft: flowDraft });
    await call("kotikit_spec_create", { draft: singleDraft });

    const result = await call("kotikit_spec_list", {});
    const text = getText(result);
    expect(text).toContain("Checkout Flow");
    expect(text).toContain("Profile Page");
  });

  it("mentions each scope's kind", async () => {
    await call("kotikit_spec_create", { draft: flowDraft });

    const result = await call("kotikit_spec_list", {});
    const text = getText(result);
    expect(text).toContain("flow");
  });
});
