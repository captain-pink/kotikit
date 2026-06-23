import simpleGit from "simple-git";
import { KotikitError } from "../util/result";

export type CommitKind = "create" | "update";

export interface CommitResult {
  committed: boolean;
  reason?: string;
  sha?: string;
  message: string;
}

export interface CoAuthor {
  name: string;
  email: string;
}

export const DEFAULT_CO_AUTHOR: CoAuthor = {
  name: "Claude Code",
  email: "noreply@anthropic.com",
};

export interface AutoCommitOpts {
  root: string;
  scope: string;
  kind: CommitKind;
  files: string[];
  enabled: boolean;
  /** Co-author identity for the commit footer. Defaults to Claude Code for backwards compatibility. */
  coAuthor?: CoAuthor;
  /** Subject prefix scope. Defaults to "spec". */
  subjectScope?: "spec" | "code";
  /** Optional subject suffix appended after `scope`. E.g. "/cart" → "feat(code): create checkout-flow/cart". */
  subjectSuffix?: string;
}

export function formatCoAuthorFooter(coAuthor: CoAuthor): string {
  const name = coAuthor.name.trim();
  const email = coAuthor.email.trim();
  if (name.length === 0) {
    throw new KotikitError("The commit co-author name is empty.");
  }
  if (email.length === 0) {
    throw new KotikitError("The commit co-author email is empty.");
  }
  return `Co-authored-by: ${name} <${email}>`;
}

/**
 * Generic auto-commit. Stages the given files and creates a local
 * conventional commit. Never pushes. Never creates or switches branches.
 */
export async function autoCommit(opts: AutoCommitOpts): Promise<CommitResult> {
  const scopePrefix = opts.subjectScope ?? "spec";
  const suffix = opts.subjectSuffix ?? "";
  const subject = `feat(${scopePrefix}): ${opts.kind} ${opts.scope}${suffix}`;
  const body = `\n\n${formatCoAuthorFooter(opts.coAuthor ?? DEFAULT_CO_AUTHOR)}`;
  const fullMessage = subject + body;

  if (!opts.enabled) {
    return { committed: false, reason: "autoCommit is off", message: subject };
  }

  const repoCheck = await isGitRepo(opts.root);
  if (!repoCheck) {
    return { committed: false, reason: "not a git repo", message: subject };
  }

  const git = simpleGit({ baseDir: opts.root, binary: "git" });

  // Stage only the specified files
  for (const file of opts.files) {
    // Use relative path if absolute, otherwise use as-is
    const rel = file.startsWith(opts.root) ? file.slice(opts.root.length).replace(/^\//, "") : file;
    await git.add(rel);
  }

  // Check if there's actually anything staged
  const status = await git.status();
  const staged = [...status.staged, ...status.created, ...status.renamed.map((r) => r.to)];
  if (staged.length === 0) {
    return { committed: false, reason: "no changes", message: subject };
  }

  const result = await git.commit(fullMessage);
  const sha = result.commit;

  return { committed: true, sha, message: subject };
}

/** Backwards-compatible alias — calls autoCommit with subjectScope: "spec". */
export async function autoCommitSpec(opts: {
  root: string;
  scope: string;
  kind: CommitKind;
  files: string[];
  enabled: boolean;
  coAuthor?: CoAuthor;
}): Promise<CommitResult> {
  return autoCommit(opts); // defaults to subjectScope: "spec"
}

/** Returns true if `root` is inside a git repository. */
export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const git = simpleGit({ baseDir: root, binary: "git" });
    await git.revparse(["--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Initialize a new local git repository at `root`. Does not add a remote. */
export async function gitInit(root: string): Promise<void> {
  const git = simpleGit({ baseDir: root, binary: "git" });
  await git.init();
}

// Ensure KotikitError is referenced to satisfy noUnusedLocals
void (KotikitError as unknown);
