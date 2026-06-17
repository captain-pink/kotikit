import { autoCommit, type CoAuthor, type CommitResult } from "../git/auto-commit.js";

export async function autoCommitCode(opts: {
  root: string;
  scope: string;
  screen: string | null; // null for single-screen scopes
  kind: "create" | "update";
  files: string[]; // absolute paths to the generated files (also includes registry.db etc.)
  enabled: boolean;
  coAuthor?: CoAuthor;
}): Promise<CommitResult> {
  const subjectSuffix = opts.screen ? `/${opts.screen}` : "";
  return autoCommit({
    root: opts.root,
    scope: opts.scope,
    kind: opts.kind,
    files: opts.files,
    enabled: opts.enabled,
    coAuthor: opts.coAuthor,
    subjectScope: "code",
    subjectSuffix,
  });
}
