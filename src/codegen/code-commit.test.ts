import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import simpleGit from "simple-git";
import { autoCommitCode } from "./code-commit.js";

const tmpDirs: string[] = [];
async function mkTmpRepo(): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), "kotikit-code-commit-"));
  tmpDirs.push(d);
  const git = simpleGit(d);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

async function writeAndStageFile(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  const abs = join(root, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe("autoCommitCode", () => {
  it("single-screen scope: subject is 'feat(code): create profile-page'", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/profile-page/ProfilePage.tsx",
      "x",
    );
    const result = await autoCommitCode({
      root,
      scope: "profile-page",
      screen: null,
      kind: "create",
      files: [file],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(code): create profile-page");
  });

  it("multi-screen scope: subject is 'feat(code): create <scope>/<screen>'", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/checkout-flow/Cart.tsx",
      "x",
    );
    const result = await autoCommitCode({
      root,
      scope: "checkout-flow",
      screen: "cart",
      kind: "create",
      files: [file],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(code): create checkout-flow/cart");
  });

  it("update kind: subject uses update", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/x/X.tsx",
      "v1",
    );
    await autoCommitCode({
      root,
      scope: "x",
      screen: null,
      kind: "create",
      files: [file],
      enabled: true,
    });

    writeFileSync(file, "v2");
    const result = await autoCommitCode({
      root,
      scope: "x",
      screen: null,
      kind: "update",
      files: [file],
      enabled: true,
    });
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(code): update x");
  });

  it("enabled: false produces no commit", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/x/X.tsx",
      "x",
    );
    const result = await autoCommitCode({
      root,
      scope: "x",
      screen: null,
      kind: "create",
      files: [file],
      enabled: false,
    });
    expect(result.committed).toBe(false);
  });

  it("commit body contains Co-authored-by footer", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/x/X.tsx",
      "x",
    );
    await autoCommitCode({
      root,
      scope: "x",
      screen: null,
      kind: "create",
      files: [file],
      enabled: true,
    });
    const git = simpleGit(root);
    const log = await git.log();
    const last = log.all[0];
    // Default body or message should mention Claude Code for backwards compatibility.
    expect((last?.body ?? "") + (last?.message ?? "")).toContain(
      "Co-authored-by: Claude Code",
    );
  });

  it("commit body can use a configured Codex co-author footer", async () => {
    const root = await mkTmpRepo();
    const file = await writeAndStageFile(
      root,
      "src/components/x/X.tsx",
      "x",
    );
    await autoCommitCode({
      root,
      scope: "x",
      screen: null,
      kind: "create",
      files: [file],
      enabled: true,
      coAuthor: {
        name: "Codex",
        email: "noreply@openai.com",
      },
    });
    const git = simpleGit(root);
    const log = await git.log();
    const last = log.all[0];
    expect((last?.body ?? "") + (last?.message ?? "")).toContain(
      "Co-authored-by: Codex <noreply@openai.com>",
    );
  });
});
