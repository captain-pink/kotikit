export type IssueKind = "bug" | "feature";

export type IssueWorkflowArea =
  | "setup"
  | "sync"
  | "planning"
  | "figma-apply"
  | "qa"
  | "feedback"
  | "mcp"
  | "docs";

export interface IssueRunDiagnostics {
  status: string;
  flowId?: string;
  flowVersion?: string;
  graphHash?: string;
  artifactCounts?: Record<string, number>;
}

export interface IssueDoctorDiagnostic {
  id: string;
  status: string;
}

export interface IssuePreviewDiagnostics {
  kotikitVersion?: string;
  runtime?: string;
  platform?: string;
  arch?: string;
  run?: IssueRunDiagnostics;
  doctor?: IssueDoctorDiagnostic[];
}

export interface IssuePreviewInput {
  kind: IssueKind;
  summary: string;
  userGoal: string;
  observedProblem?: string;
  desiredBehavior: string;
  impact?: string;
  workflowArea?: IssueWorkflowArea;
  sensitiveTerms?: string[];
  diagnostics?: IssuePreviewDiagnostics;
}

export interface IssuePreviewResult {
  title: string;
  bodyPreview: string;
  githubIssueUrl: string;
  redactions: string[];
  omittedFields: string[];
  warnings: string[];
}

const ISSUE_URL = "https://github.com/captain-pink/kotikit/issues/new";
const MAX_ISSUE_URL_LENGTH = 7_500;

const BASE_REDACTIONS = ["raw project/product/customer details"];

/** Build a public-safe GitHub issue draft URL from an assistant-generalized brief. */
export function buildIssuePreview(input: IssuePreviewInput): IssuePreviewResult {
  const redactions = new Set(BASE_REDACTIONS);
  const sanitize = (value: string): string =>
    sanitizeText(value, input.sensitiveTerms ?? [], redactions);
  const title = `${input.kind === "bug" ? "Bug" : "Feature"}: ${clipTitle(sanitize(input.summary))}`;
  const bodyPreview = buildBody(input, sanitize);
  const label = input.kind === "bug" ? "bug" : "feature";
  const fullUrl = issueUrl(title, bodyPreview, label);
  const warnings: string[] = [];

  if (fullUrl.length <= MAX_ISSUE_URL_LENGTH) {
    return {
      title,
      bodyPreview,
      githubIssueUrl: fullUrl,
      redactions: Array.from(redactions),
      omittedFields: [],
      warnings,
    };
  }

  warnings.push(
    "The issue URL was shortened because the full preview was too large for a reliable browser URL."
  );
  const shortenedBody = buildShortBody(input, sanitize);
  return {
    title,
    bodyPreview,
    githubIssueUrl: issueUrl(title, shortenedBody, label),
    redactions: Array.from(redactions),
    omittedFields: ["full issue body in url"],
    warnings,
  };
}

function buildBody(input: IssuePreviewInput, sanitize: (value: string) => string): string {
  const sections = [
    section("User goal", sanitize(input.userGoal)),
    input.kind === "bug" && input.observedProblem
      ? section("Observed problem", sanitize(input.observedProblem))
      : undefined,
    section(
      input.kind === "bug" ? "Expected behavior" : "Suggested behavior",
      sanitize(input.desiredBehavior)
    ),
    input.impact ? section("Impact", sanitize(input.impact)) : undefined,
    input.workflowArea ? section("Workflow area", input.workflowArea) : undefined,
    input.diagnostics
      ? section("Sanitized diagnostics", sanitize(formatDiagnostics(input.diagnostics)))
      : undefined,
    section(
      "Privacy review",
      "This draft is generated for public GitHub review. Remove anything you do not want public before submitting."
    ),
  ];
  return sections.filter((item): item is string => item !== undefined).join("\n\n");
}

function buildShortBody(input: IssuePreviewInput, sanitize: (value: string) => string): string {
  return [
    section("User goal", sanitize(input.userGoal)),
    section(
      input.kind === "bug" ? "Expected behavior" : "Suggested behavior",
      sanitize(input.desiredBehavior)
    ),
    section(
      "Privacy review",
      "The full local preview was too large for a reliable issue URL. Review this shortened public draft before submitting."
    ),
  ].join("\n\n");
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}`;
}

function formatDiagnostics(diagnostics: IssuePreviewDiagnostics): string {
  const lines: string[] = [];
  if (diagnostics.kotikitVersion) lines.push(`- Kotikit version: ${diagnostics.kotikitVersion}`);
  if (diagnostics.runtime) lines.push(`- Runtime: ${diagnostics.runtime}`);
  if (diagnostics.platform || diagnostics.arch) {
    lines.push(`- Platform: ${[diagnostics.platform, diagnostics.arch].filter(Boolean).join("/")}`);
  }
  if (diagnostics.run) {
    lines.push(`- Run status: ${diagnostics.run.status}`);
    if (diagnostics.run.flowId) {
      lines.push(
        `- Flow: ${diagnostics.run.flowId}${
          diagnostics.run.flowVersion ? `@${diagnostics.run.flowVersion}` : ""
        }`
      );
    }
    if (diagnostics.run.graphHash) lines.push(`- Graph hash: ${diagnostics.run.graphHash}`);
    const artifactCounts = formatArtifactCounts(diagnostics.run.artifactCounts);
    if (artifactCounts) lines.push(`- Artifact counts: ${artifactCounts}`);
  }
  if (diagnostics.doctor && diagnostics.doctor.length > 0) {
    lines.push(
      `- Doctor checks: ${diagnostics.doctor.map((item) => `${item.id}=${item.status}`).join(", ")}`
    );
  }
  return lines.length > 0 ? lines.join("\n") : "- No sanitized diagnostics were available.";
}

function formatArtifactCounts(counts: Record<string, number> | undefined): string | undefined {
  if (counts === undefined) return undefined;
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  return entries.map(([type, count]) => `${type}=${count}`).join(", ");
}

function issueUrl(title: string, body: string, label: string): string {
  const params = new URLSearchParams({ title, body, labels: label });
  return `${ISSUE_URL}?${params.toString()}`;
}

function clipTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= 100 ? trimmed : `${trimmed.slice(0, 97).trimEnd()}...`;
}

function sanitizeText(value: string, sensitiveTerms: string[], redactions: Set<string>): string {
  let sanitized = value;
  for (const term of sensitiveTerms.toSorted((left, right) => right.length - left.length)) {
    if (term.trim().length === 0) continue;
    const pattern = new RegExp(escapeRegExp(term.trim()), "gi");
    if (pattern.test(sanitized)) {
      redactions.add("assistant-provided sensitive terms");
      sanitized = sanitized.replace(pattern, "[redacted]");
    }
  }

  sanitized = replaceIfChanged(
    sanitized,
    /\bhttps:\/\/(?:www\.)?figma\.com\/[^\s)]+/gi,
    "[redacted figma url]",
    "figma urls",
    redactions
  );
  sanitized = replaceIfChanged(
    sanitized,
    /(?:^|\s)(?:\/Users\/[^\s)]+|\/private\/[^\s)]+|\/tmp\/[^\s)]+|[A-Za-z]:\\[^\s)]+)/g,
    " [redacted path]",
    "absolute paths",
    redactions
  );
  sanitized = replaceIfChanged(
    sanitized,
    /\b(?:(?:figd|ghp|github_pat)[A-Za-z0-9_:-]{6,}|figma[_:-]?(?:token|pat|secret)[A-Za-z0-9_:-]{4,}|(?:tok|token|secret)[_:-][A-Za-z0-9_:-]{8,})\b/gi,
    "[redacted token]",
    "token-like values",
    redactions
  );
  sanitized = replaceIfChanged(
    sanitized,
    /\b[A-Z0-9]{6,}\b/g,
    "[redacted identifier]",
    "opaque identifiers",
    redactions
  );

  return sanitized.trim();
}

function replaceIfChanged(
  value: string,
  pattern: RegExp,
  replacement: string,
  label: string,
  redactions: Set<string>
): string {
  const next = value.replace(pattern, replacement);
  if (next !== value) redactions.add(label);
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
