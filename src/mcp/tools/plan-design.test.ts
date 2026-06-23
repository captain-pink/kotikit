import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import simpleGit from "simple-git";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import type { FigmaDraftTarget } from "../../figma/draft-target.js";
import { DesignPlanSchema } from "../../planning/design-plan-schema.js";
import { writeFlowManifest, writeScreenSpec } from "../../spec/engine.js";
import { newFlowManifest, newScreenSpec } from "../../spec/schema.js";
import { designPlanPath } from "../../util/paths.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerPlanDesignTools } from "./plan-design.js";

const tmpDirs: string[] = [];
async function mkTmpRepo(opts?: { autoCommit?: boolean }): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), "kotikit-plan-design-"));
  tmpDirs.push(d);
  const git = simpleGit(d);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  const cfg = defaultConfig();
  cfg.git.autoCommit = opts?.autoCommit ?? true;
  await writeConfig(d, cfg);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}
function makeCtx(root: string): ToolContext {
  return {
    root,
    loadConfig: async () => {
      const { loadConfig } = await import("../../config/load.js");
      return loadConfig(root);
    },
  };
}
async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
}

const target = (pageName = "Draft - Profile"): FigmaDraftTarget => ({
  fileKey: "fig-file",
  pageId: "0:1",
  pageName,
  pageUrl: "https://www.figma.com/design/fig-file/App?node-id=0-1",
  boundAt: "2026-06-22T00:00:00.000Z",
  source: "user-url",
  section: { name: "kotikit / profile-page / 2026-06-22" },
  safety: {
    requireDraftPageName: true,
    allowPageCreation: false,
    requireKotikitSection: true,
  },
});

describe("kotikit_plan_design", () => {
  it("single-screen: writes <scope>/design.plan.json", async () => {
    const root = await mkTmpRepo();
    const spec = newScreenSpec({ title: "Profile Page", description: "User profile." });
    spec.requirements.states = { default: "x" };
    spec.figmaTarget = target();
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

    expect(result.isError).toBeFalsy();
    expect(existsSync(`${root}/.kotikit/specs/profile-page/design.plan.json`)).toBe(true);

    const onDisk = JSON.parse(
      readFileSync(`${root}/.kotikit/specs/profile-page/design.plan.json`, "utf-8")
    );
    const plan = DesignPlanSchema.parse(onDisk);
    expect(plan.pageName).toBe("ProfilePage");
    expect(plan.target?.pageName).toBe("Draft - Profile");
  });

  it("multi-screen: writes <scope>/<screen>.design.plan.json", async () => {
    const root = await mkTmpRepo();
    const manifest = newFlowManifest({
      title: "Checkout",
      description: "x",
      screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
    });
    manifest.figmaTarget = target("Checkout Drafts");
    await writeFlowManifest(root, "checkout-flow", manifest);
    const spec = newScreenSpec({
      title: "Cart",
      description: "y",
      flowRef: "checkout-flow/flow.json",
    });
    spec.requirements.states = { loading: "x" };
    await writeScreenSpec(root, "checkout-flow", "cart", spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_design", {
      scope: "checkout-flow",
      screen: "cart",
    });

    expect(result.isError).toBeFalsy();
    expect(existsSync(`${root}/.kotikit/specs/checkout-flow/cart.design.plan.json`)).toBe(true);
  });

  it("blocks design planning until a draft target is bound", async () => {
    const root = await mkTmpRepo();
    const spec = newScreenSpec({ title: "Profile Page", description: "User profile." });
    spec.requirements.states = { default: "x" };
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("draft page link");
  });

  it("missing spec: friendly error", async () => {
    const root = await mkTmpRepo();
    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_plan_design", { scope: "does-not-exist" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("couldn't find");
  });

  it("auto-commit produces a 'feat(spec): create design plan <scope>' commit", async () => {
    const root = await mkTmpRepo({ autoCommit: true });
    const spec = newScreenSpec({ title: "Profile Page", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.figmaTarget = target();
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

    const git = simpleGit(root);
    const log = await git.log();
    const subject = log.all[0]?.message ?? "";
    expect(subject).toContain("feat(spec): create design plan profile-page");
  });

  it("multi-screen commit subject includes /screen", async () => {
    const root = await mkTmpRepo({ autoCommit: true });
    const manifest = newFlowManifest({
      title: "Checkout",
      description: "x",
      screens: [{ id: "cart", path: "cart.spec.json", title: "Cart" }],
    });
    manifest.figmaTarget = target("Checkout Drafts");
    await writeFlowManifest(root, "checkout-flow", manifest);
    const spec = newScreenSpec({
      title: "Cart",
      description: "y",
      flowRef: "checkout-flow/flow.json",
    });
    spec.requirements.states = { default: "x" };
    await writeScreenSpec(root, "checkout-flow", "cart", spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_plan_design", { scope: "checkout-flow", screen: "cart" });

    const git = simpleGit(root);
    const log = await git.log();
    const subject = log.all[0]?.message ?? "";
    expect(subject).toContain("feat(spec): create design plan checkout-flow/cart");
  });

  it("update kind: re-running the tool produces a 'feat(spec): update design plan' commit", async () => {
    const root = await mkTmpRepo({ autoCommit: true });
    const spec = newScreenSpec({ title: "P", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.figmaTarget = target();
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });
    // Second run — file already exists, should be kind: "update"
    await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

    const git = simpleGit(root);
    const log = await git.log();
    const subjects = log.all.map((c) => c.message);
    expect(subjects.some((s) => s.includes("feat(spec): update design plan profile-page"))).toBe(
      true
    );
  });

  it("autoCommit off: no commit, but plan file is written", async () => {
    const root = await mkTmpRepo({ autoCommit: false });
    const spec = newScreenSpec({ title: "P", description: "x" });
    spec.requirements.states = { default: "x" };
    spec.figmaTarget = target();
    await writeScreenSpec(root, "profile-page", null, spec);

    const registry = makeRegistry();
    registerPlanDesignTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_plan_design", { scope: "profile-page" });

    expect(existsSync(designPlanPath(root, "profile-page", null))).toBe(true);
    const git = simpleGit(root);
    const log = await git.log().catch(() => null);
    expect((log?.all ?? []).find((c) => c.message.includes("design plan"))).toBeUndefined();
  });
});
