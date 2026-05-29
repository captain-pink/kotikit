import { autoCommit, type CommitResult } from "../git/auto-commit.js";

export async function autoCommitCode(opts: {
  root: string;
  scope: string;
  screen: string | null; // null for single-screen scopes
  kind: "create" | "update";
  files: string[]; // absolute paths to the generated files (also includes registry.db etc.)
  enabled: boolean;
}): Promise<CommitResult> {
  const subjectSuffix = opts.screen ? `/${opts.screen}` : "";
  return autoCommit({
    root: opts.root,
    scope: opts.scope,
    kind: opts.kind,
    files: opts.files,
    enabled: opts.enabled,
    subjectScope: "code",
    subjectSuffix,
  });
}
