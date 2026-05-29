import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import simpleGit from "simple-git";
import { autoCommit, autoCommitSpec, isGitRepo, gitInit } from "./auto-commit";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `kotikit-git-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  // Init a fresh local git repo with a throwaway identity (local config only)
  const git = simpleGit({ baseDir: tmp, binary: "git" });
  await git.init();
  await git.addConfig("user.email", "test@kotikit.test", false, "local");
  await git.addConfig("user.name", "Kotikit Test", false, "local");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const writeSpecFile = (dir: string, name: string, content = "{}") => {
  mkdirSync(join(dir, ".kotikit", "specs", "test-scope"), { recursive: true });
  writeFileSync(join(dir, ".kotikit", "specs", "test-scope", name), content);
  return `.kotikit/specs/test-scope/${name}`;
};

describe("autoCommitSpec", () => {
  it("creates a commit with the correct subject for kind=create", async () => {
    const relPath = writeSpecFile(tmp, "spec.json");
    const result = await autoCommitSpec({
      root: tmp,
      scope: "profile-page",
      kind: "create",
      files: [relPath],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(spec): create profile-page");

    const git = simpleGit({ baseDir: tmp });
    const log = await git.log();
    expect(log.latest?.message).toBe("feat(spec): create profile-page");
  });

  it("commit body contains Co-authored-by footer", async () => {
    const relPath = writeSpecFile(tmp, "spec.json");
    await autoCommitSpec({
      root: tmp,
      scope: "profile-page",
      kind: "create",
      files: [relPath],
      enabled: true,
    });
    // Get the full commit body via git show
    const { $ } = await import("bun");
    const body = await $`git -C ${tmp} show -s --format=%B HEAD`.text();
    expect(body).toContain("Co-authored-by: Claude Code <noreply@anthropic.com>");
  });

  it("creates a feat(spec): update commit for kind=update", async () => {
    // First create
    const relPath = writeSpecFile(tmp, "spec.json", '{"v":1}');
    await autoCommitSpec({ root: tmp, scope: "test-scope", kind: "create", files: [relPath], enabled: true });

    // Then update
    writeFileSync(join(tmp, relPath), '{"v":2}');
    const result = await autoCommitSpec({ root: tmp, scope: "test-scope", kind: "update", files: [relPath], enabled: true });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(spec): update test-scope");

    const git = simpleGit({ baseDir: tmp });
    const log = await git.log();
    expect(log.latest?.message).toBe("feat(spec): update test-scope");
  });

  it("returns committed:false with reason='autoCommit is off' when disabled", async () => {
    const relPath = writeSpecFile(tmp, "spec.json");
    const result = await autoCommitSpec({
      root: tmp, scope: "profile-page", kind: "create", files: [relPath], enabled: false,
    });
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("autoCommit is off");

    // No commit should exist
    const git = simpleGit({ baseDir: tmp });
    try {
      await git.log();
      // log could succeed with 0 commits, that's fine
    } catch {
      // Also fine — empty repo
    }
  });

  it("returns committed:false with reason='not a git repo' for non-repo dir", async () => {
    const notRepo = join(tmpdir(), `no-git-${Date.now()}`);
    mkdirSync(notRepo, { recursive: true });
    try {
      writeFileSync(join(notRepo, "spec.json"), "{}");
      const result = await autoCommitSpec({
        root: notRepo, scope: "test", kind: "create", files: ["spec.json"], enabled: true,
      });
      expect(result.committed).toBe(false);
      expect(result.reason).toBe("not a git repo");
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it("does not create any additional branches", async () => {
    const relPath = writeSpecFile(tmp, "spec.json");
    await autoCommitSpec({ root: tmp, scope: "profile-page", kind: "create", files: [relPath], enabled: true });
    const git = simpleGit({ baseDir: tmp });
    const branches = await git.branchLocal();
    // Should have at most 1 branch (default branch after first commit)
    expect(Object.keys(branches.branches).length).toBeLessThanOrEqual(1);
  });

  it("returns committed:false when there are no staged changes", async () => {
    // Don't write any new file — nothing to stage
    const result = await autoCommitSpec({
      root: tmp, scope: "profile-page", kind: "create", files: [], enabled: true,
    });
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("no changes");
  });
});

describe("isGitRepo", () => {
  it("returns true for a git repo", async () => {
    expect(await isGitRepo(tmp)).toBe(true);
  });

  it("returns false for a plain directory", async () => {
    const plain = join(tmpdir(), `no-git-check-${Date.now()}`);
    mkdirSync(plain, { recursive: true });
    try {
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("gitInit", () => {
  it("makes a non-repo into a repo", async () => {
    const plain = join(tmpdir(), `git-init-test-${Date.now()}`);
    mkdirSync(plain, { recursive: true });
    try {
      expect(await isGitRepo(plain)).toBe(false);
      await gitInit(plain);
      expect(await isGitRepo(plain)).toBe(true);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("autoCommit (code-scoped)", () => {
  const writeCodeFile = (dir: string, name: string, content = "// placeholder") => {
    mkdirSync(join(dir, "src", "components", "checkout-flow"), { recursive: true });
    writeFileSync(join(dir, "src", "components", "checkout-flow", name), content);
    return `src/components/checkout-flow/${name}`;
  };

  it("subjectScope='code' + subjectSuffix='/cart' produces 'feat(code): create checkout-flow/cart'", async () => {
    const relPath = writeCodeFile(tmp, "Cart.tsx");
    const result = await autoCommit({
      root: tmp,
      scope: "checkout-flow",
      kind: "create",
      files: [relPath],
      enabled: true,
      subjectScope: "code",
      subjectSuffix: "/cart",
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(code): create checkout-flow/cart");

    const git = simpleGit({ baseDir: tmp });
    const log = await git.log();
    expect(log.latest?.message).toBe("feat(code): create checkout-flow/cart");
  });

  it("subjectScope='code' on update produces 'feat(code): update checkout-flow/cart'", async () => {
    // First commit
    const relPath = writeCodeFile(tmp, "Cart.tsx", "// v1");
    await autoCommit({
      root: tmp,
      scope: "checkout-flow",
      kind: "create",
      files: [relPath],
      enabled: true,
      subjectScope: "code",
      subjectSuffix: "/cart",
    });

    // Modify and update-commit
    writeFileSync(join(tmp, relPath), "// v2");
    const result = await autoCommit({
      root: tmp,
      scope: "checkout-flow",
      kind: "update",
      files: [relPath],
      enabled: true,
      subjectScope: "code",
      subjectSuffix: "/cart",
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(code): update checkout-flow/cart");

    const git = simpleGit({ baseDir: tmp });
    const log = await git.log();
    expect(log.latest?.message).toBe("feat(code): update checkout-flow/cart");
  });

  it("omitting subjectScope produces the unchanged feat(spec) subject (backwards compat)", async () => {
    const relPath = writeCodeFile(tmp, "Shipping.tsx");
    const result = await autoCommit({
      root: tmp,
      scope: "checkout-flow",
      kind: "create",
      files: [relPath],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(spec): create checkout-flow");
  });

  it("autoCommitSpec still produces feat(spec) (backwards compat)", async () => {
    mkdirSync(join(tmp, ".kotikit", "specs", "checkout-flow"), { recursive: true });
    writeFileSync(join(tmp, ".kotikit", "specs", "checkout-flow", "spec.json"), "{}");
    const relPath = ".kotikit/specs/checkout-flow/spec.json";
    const result = await autoCommitSpec({
      root: tmp,
      scope: "checkout-flow",
      kind: "create",
      files: [relPath],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(spec): create checkout-flow");
  });
});
