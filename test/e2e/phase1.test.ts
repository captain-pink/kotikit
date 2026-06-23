import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import { loadConfig } from "../../src/config/load.js";
import { ConfigSchema } from "../../src/config/schema.js";
import type { ToolContext } from "../../src/mcp/context.js";
import type { ToolRegistry } from "../../src/mcp/server.js";
import { registerBrainstormTools } from "../../src/mcp/tools/brainstorm.js";
import { registerConfigTools } from "../../src/mcp/tools/config.js";
import { registerFlowTools } from "../../src/mcp/tools/flow.js";
import { registerSpecTools } from "../../src/mcp/tools/spec.js";
import type { FlowDraft, SingleDraft } from "../../src/spec/decompose.js";
import { FlowManifestSchema, ScreenSpecSchema } from "../../src/spec/schema.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[]; isError?: boolean };

function buildTestServer(root: string): ToolRegistry {
  const tools: Tool[] = [];
  const handlers = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const registry: ToolRegistry = { tools, handlers };
  const ctx: ToolContext = { root, loadConfig: () => loadConfig(root) };
  registerConfigTools(registry, ctx);
  registerSpecTools(registry, ctx);
  registerFlowTools(registry, ctx);
  registerBrainstormTools(registry, ctx);
  return registry;
}

async function callTool(registry: ToolRegistry, name: string, args: unknown): Promise<ToolResult> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`Tool not found: ${name}`);
  return handler(args);
}

async function setupTempRepo(): Promise<{ tmpDir: string; git: ReturnType<typeof simpleGit> }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "kotikit-e2e-"));
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test Runner");
  return { tmpDir, git };
}

// ─── Test: Happy path — checkout flow ────────────────────────────────────────

describe("Phase 1 E2E — happy path", () => {
  let checkoutTmpDir: string;
  let singleTmpDir: string;

  afterAll(async () => {
    if (checkoutTmpDir) await rm(checkoutTmpDir, { recursive: true, force: true });
    if (singleTmpDir) await rm(singleTmpDir, { recursive: true, force: true });
  });

  it("checkout flow: idea → spec files → git commit", async () => {
    // ── Setup ──────────────────────────────────────────────────────────────
    const { tmpDir, git } = await setupTempRepo();
    checkoutTmpDir = tmpDir;
    const registry = buildTestServer(tmpDir);

    // ── Step 1: config_status before init ──────────────────────────────────
    const statusResult = await callTool(registry, "kotikit_config_status", {});
    const statusText = statusResult.content[0].text;
    // The text contains JSON after a blank line separator
    const statusJsonStr = statusText.includes("\n\n")
      ? statusText.split("\n\n").slice(1).join("\n\n")
      : null;
    if (statusJsonStr) {
      const statusData = JSON.parse(statusJsonStr) as { initialized: boolean };
      expect(statusData.initialized).toBe(false);
    } else {
      // Fallback: the summary line itself signals not initialized
      expect(statusText.toLowerCase()).toContain("not");
    }

    // ── Step 2: config_init ────────────────────────────────────────────────
    await callTool(registry, "kotikit_config_init", { tests: true, autoCommit: true });
    expect(existsSync(`${tmpDir}/.kotikit/config.json`)).toBe(true);
    const configRaw = JSON.parse(await readFile(`${tmpDir}/.kotikit/config.json`, "utf-8"));
    ConfigSchema.parse(configRaw); // throws if invalid

    // ── Step 3: brainstorm_start ───────────────────────────────────────────
    const bsResult = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "checkout flow: cart, shipping, payment, review, confirmation",
    });
    const bsText = bsResult.content[0].text;
    const bsJsonStr = bsText.split("\n\n").slice(1).join("\n\n");
    const bsData = JSON.parse(bsJsonStr) as {
      classification: string;
      coverageChecklist: string[];
    };
    expect(bsData.classification).toBe("multiScreen");
    expect(bsData.coverageChecklist).toContain("flowConnectivity");

    // ── Step 4 & 5: build FlowDraft and call flow_create ───────────────────
    const draft: FlowDraft = {
      scope: "checkout-flow",
      title: "Checkout Flow",
      description: "Full purchase flow from cart to confirmation.",
      screens: [
        {
          slug: "cart",
          title: "Cart",
          description: "Shows items in cart.",
          functional: ["Display cart items", "Show total price"],
          states: {
            loading: "Spinner",
            empty: "Empty cart message",
            error: "Error banner",
            filled: "List of items",
          },
        },
        {
          slug: "shipping",
          title: "Shipping",
          description: "Collect shipping address.",
          functional: ["Address form"],
          states: {
            loading: "Spinner",
            empty: "Blank form",
            error: "Validation errors",
            filled: "Filled address",
          },
        },
        {
          slug: "payment",
          title: "Payment",
          description: "Collect payment details.",
          functional: ["Payment form"],
          states: {
            loading: "Spinner",
            empty: "Blank form",
            error: "Card error",
            filled: "Card entered",
          },
        },
        {
          slug: "review",
          title: "Review",
          description: "Review order before placing.",
          functional: ["Show order summary"],
          states: {
            loading: "Spinner",
            empty: "-",
            error: "Error",
            filled: "Full summary",
          },
        },
        {
          slug: "confirmation",
          title: "Confirmation",
          description: "Order placed successfully.",
          functional: ["Show confirmation number"],
          states: {
            loading: "Spinner",
            empty: "-",
            error: "Failed",
            filled: "Confirmation shown",
          },
        },
      ],
      transitions: [
        { from: "cart", to: "shipping", trigger: "Proceed to shipping" },
        { from: "shipping", to: "payment", trigger: "Continue to payment" },
        { from: "payment", to: "review", trigger: "Review order" },
        { from: "review", to: "confirmation", trigger: "Place order" },
      ],
      sharedState: ["cartItems", "shippingAddress", "paymentMethod"],
    };

    const createResult = await callTool(registry, "kotikit_flow_create", { draft });
    expect(createResult.isError).toBeUndefined();

    // ── Step 6: Assert on disk ─────────────────────────────────────────────
    // config.json valid
    const configJson = JSON.parse(await readFile(`${tmpDir}/.kotikit/config.json`, "utf-8"));
    ConfigSchema.parse(configJson);

    // flow.json exists and is valid
    const flowJson = JSON.parse(
      await readFile(`${tmpDir}/.kotikit/specs/checkout-flow/flow.json`, "utf-8")
    );
    const flow = FlowManifestSchema.parse(flowJson);
    expect(flow.screens).toHaveLength(5);

    // 5 spec files, each valid, each with correct flowRef
    for (const slug of ["cart", "shipping", "payment", "review", "confirmation"]) {
      const specJson = JSON.parse(
        await readFile(`${tmpDir}/.kotikit/specs/checkout-flow/${slug}.spec.json`, "utf-8")
      );
      const spec = ScreenSpecSchema.parse(specJson);
      expect(spec.flowRef).toBe("checkout-flow/flow.json");
    }

    // index.json lists the flow
    const indexJson = JSON.parse(await readFile(`${tmpDir}/.kotikit/index.json`, "utf-8")) as {
      scope: string;
      kind: string;
    }[];
    const flowEntry = indexJson.find((e) => e.scope === "checkout-flow");
    if (flowEntry === undefined) {
      throw new Error("Expected checkout flow index entry.");
    }
    expect(flowEntry.kind).toBe("flow");

    // ── Step 7: Assert git ─────────────────────────────────────────────────
    const log = await git.log();
    const specCommit = log.all.find((c) => c.message.includes("feat(spec): create checkout-flow"));
    if (specCommit === undefined) {
      throw new Error("Expected checkout flow spec commit.");
    }

    // Check Co-authored-by in commit body
    const { $ } = await import("bun");
    const body = await $`git -C ${tmpDir} show -s --format=%B ${specCommit.hash}`.text();
    expect(body).toContain("Co-authored-by: Claude Code");

    // No extra branches
    const branches = await git.branch();
    expect(branches.all.length).toBe(1);

    // ── Step 8: spec_update ────────────────────────────────────────────────
    await callTool(registry, "kotikit_spec_update", {
      scope: "checkout-flow",
      screen: "cart",
      patch: { title: "Shopping Cart" },
    });

    const updatedSpecJson = JSON.parse(
      await readFile(`${tmpDir}/.kotikit/specs/checkout-flow/cart.spec.json`, "utf-8")
    );
    const updatedSpec = ScreenSpecSchema.parse(updatedSpecJson);
    expect(updatedSpec.title).toBe("Shopping Cart");
    expect(new Date(updatedSpec.metadata.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(updatedSpec.metadata.createdAt).getTime()
    );

    // Git: update commit exists
    const updatedLog = await git.log();
    const updateCommit = updatedLog.all.find((c) =>
      c.message.includes("feat(spec): update checkout-flow")
    );
    expect(updateCommit).toBeDefined();

    // ── Step 9: spec_list ──────────────────────────────────────────────────
    const listResult = await callTool(registry, "kotikit_spec_list", {});
    const listText = listResult.content[0].text;
    expect(listText).toContain("Checkout Flow");
  });

  // ─── Test: Single-screen variant ─────────────────────────────────────────

  it("single screen: profile page → spec.json → git commit", async () => {
    // ── Setup ──────────────────────────────────────────────────────────────
    const { tmpDir, git } = await setupTempRepo();
    singleTmpDir = tmpDir;
    const registry = buildTestServer(tmpDir);

    // config_init
    await callTool(registry, "kotikit_config_init", { autoCommit: true });

    // brainstorm_start → singleScreen
    const bsResult = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a profile page",
    });
    const bsText = bsResult.content[0].text;
    const bsJsonStr = bsText.split("\n\n").slice(1).join("\n\n");
    const bsData = JSON.parse(bsJsonStr) as {
      classification: string;
      coverageChecklist: string[];
    };
    expect(bsData.classification).toBe("singleScreen");
    expect(bsData.coverageChecklist).not.toContain("flowConnectivity");

    // spec_create with a SingleDraft
    const draft: SingleDraft = {
      scope: "profile-page",
      screen: {
        slug: "profile",
        title: "Profile Page",
        description: "Shows user profile information.",
        functional: ["Display name and avatar", "Edit profile button"],
        states: {
          loading: "Spinner",
          empty: "No profile data",
          error: "Error message",
          filled: "Full profile shown",
        },
      },
    };
    await callTool(registry, "kotikit_spec_create", { draft });

    // Assert spec.json on disk
    const specPath = `${tmpDir}/.kotikit/specs/profile-page/spec.json`;
    expect(existsSync(specPath)).toBe(true);
    const specJson = JSON.parse(await readFile(specPath, "utf-8"));
    const spec = ScreenSpecSchema.parse(specJson);
    expect(spec.flowRef).toBeUndefined();

    // Assert git commit
    const log = await git.log();
    const createCommit = log.all.find((c) => c.message.includes("feat(spec): create profile-page"));
    expect(createCommit).toBeDefined();
  });
});
