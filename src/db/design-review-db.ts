import type { Database } from "bun:sqlite";
import { nowIso, uuid } from "../util/ids.js";
import { designReviewDbPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import { openDb, withTransaction } from "./sqlite.js";

type SqlRow = Record<string, unknown>;

const asSqlRows = (rows: unknown[]): SqlRow[] => rows as SqlRow[];

export type ReviewCommentStatus =
  | "open"
  | "fixed"
  | "replied"
  | "needs-decision"
  | "unmapped"
  | "wont-fix"
  | "already-resolved";

export type DesignAdjustmentCategory =
  | "spacing"
  | "density"
  | "typography"
  | "hierarchy"
  | "color"
  | "component"
  | "interaction"
  | "copy"
  | "responsive"
  | "layout"
  | "other";

export type ReplyStatus = "pending" | "posted" | "failed" | "skipped";
export type PreferenceCandidateStatus = "candidate" | "promoted" | "dismissed";
export type DesignPreferenceStatus = "active" | "inactive";
export type DesignAuditTargetKind = "page" | "section" | "frame" | "component" | "unknown";
export type DesignAuditStrictness = "quick" | "standard" | "deep";
export type DesignAuditFindingCategory =
  | DesignAdjustmentCategory
  | "accessibility"
  | "content"
  | "system"
  | "visual";
export type DesignAuditFindingSeverity = "critical" | "high" | "medium" | "polish";
export type DesignAuditFindingConfidence = "observed" | "inferred" | "needs-decision";
export type DesignAuditFindingStatus = "open" | "prepared" | "posted" | "dismissed" | "fixed";

export interface ReviewSessionInput {
  scope?: string;
  screen?: string;
  fileKey: string;
  totalFetched: number;
  mappedCount: number;
  unmappedCount: number;
  skippedResolved: number;
  comments: ReviewCommentInput[];
}

export interface ReviewCommentInput {
  commentId: string;
  fileKey: string;
  parentId?: string;
  message: string;
  author?: string;
  nodeId?: string;
  status: ReviewCommentStatus;
  createdAt?: string;
  resolvedAt?: string;
  target?: unknown;
}

export interface ReviewSessionRow {
  sessionId: string;
  scope: string | null;
  screen: string | null;
  fileKey: string;
  startedAt: string;
  finishedAt: string | null;
  totalFetched: number;
  mappedCount: number;
  unmappedCount: number;
  skippedResolved: number;
}

export interface ReviewCommentRow {
  commentId: string;
  sessionId: string;
  scope: string | null;
  screen: string | null;
  fileKey: string;
  parentId: string | null;
  nodeId: string | null;
  targetJson: string | null;
  message: string;
  author: string | null;
  status: ReviewCommentStatus;
  createdAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

export interface DesignAdjustmentInput {
  sessionId?: string;
  scope?: string;
  screen?: string;
  fileKey?: string;
  commentId?: string;
  nodeId?: string;
  category: DesignAdjustmentCategory;
  summary: string;
  preferenceKey?: string;
  preferenceSummary?: string;
}

export interface DesignAdjustmentRow {
  adjustmentId: string;
  sessionId: string | null;
  scope: string | null;
  screen: string | null;
  fileKey: string | null;
  commentId: string | null;
  nodeId: string | null;
  category: DesignAdjustmentCategory;
  summary: string;
  preferenceKey: string | null;
  createdAt: string;
}

export interface CommentReplyRow {
  outboxId: string;
  sessionId: string | null;
  fileKey: string;
  commentId: string;
  message: string;
  status: ReplyStatus;
  postedCommentId: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
}

export interface PreferenceCandidateRow {
  key: string;
  category: DesignAdjustmentCategory;
  summary: string;
  rule: string;
  evidenceCount: number;
  distinctScreens: number;
  confidence: number;
  status: PreferenceCandidateStatus;
  updatedAt: string;
}

export interface DesignPreferenceRow {
  key: string;
  category: DesignAdjustmentCategory;
  rule: string;
  scope: string | null;
  status: DesignPreferenceStatus;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTargetCacheInput {
  fileKey: string;
  nodeId: string;
  depth: number;
  sourceFingerprint: string;
  summary: unknown;
  createdAt?: string;
  expiresAt: string;
}

export interface ReviewTargetCacheRow {
  cacheKey: string;
  schemaVersion: number;
  fileKey: string;
  nodeId: string;
  depth: number;
  sourceFingerprint: string;
  summaryJson: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
}

export interface DesignAuditTargetInput {
  source: "figma";
  fileKey: string;
  nodeId: string;
  targetKind: DesignAuditTargetKind;
  targetName: string;
  figmaUrl: string;
  scope?: string;
  screen?: string;
}

export interface DesignAuditBriefInput {
  surfaceType?: string;
  audience?: string;
  primaryUserGoal?: string;
  reviewGoal?: string;
  strictness: DesignAuditStrictness;
  notes?: string;
}

export interface DesignAuditSessionInput {
  target: DesignAuditTargetInput;
  brief: DesignAuditBriefInput;
  evidence: unknown;
}

export interface DesignAuditSessionRow {
  sessionId: string;
  source: "figma";
  fileKey: string;
  nodeId: string;
  targetKind: DesignAuditTargetKind;
  targetName: string;
  figmaUrl: string;
  scope: string | null;
  screen: string | null;
  briefJson: string;
  evidenceJson: string;
  startedAt: string;
  updatedAt: string;
}

export interface DesignAuditFindingInput {
  category: DesignAuditFindingCategory;
  severity: DesignAuditFindingSeverity;
  confidence: DesignAuditFindingConfidence;
  title: string;
  observation: string;
  rationale: string;
  recommendation: string;
  nodeId?: string;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  commentable: boolean;
  suggestedComment?: string;
}

export interface DesignAuditFindingRow extends DesignAuditFindingInput {
  findingId: string;
  sessionId: string;
  status: DesignAuditFindingStatus;
  regionJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignAuditCommentOutboxRow {
  outboxId: string;
  sessionId: string;
  findingId: string;
  fileKey: string;
  message: string;
  clientMetaJson: string | null;
  status: ReplyStatus;
  postedCommentId: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
}

export interface DesignAuditReport {
  session: DesignAuditSessionRow | null;
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    polish: number;
    open: number;
    preparedComments: number;
    postedComments: number;
  };
  findings: DesignAuditFindingRow[];
  pendingComments: DesignAuditCommentOutboxRow[];
}

export interface ReviewReport {
  session: ReviewSessionRow | null;
  summary: {
    totalComments: number;
    open: number;
    fixed: number;
    replied: number;
    needsDecision: number;
    unmapped: number;
    wontFix: number;
    alreadyResolved: number;
    pendingReplies: number;
    adjustments: number;
  };
  comments: ReviewCommentRow[];
  adjustments: DesignAdjustmentRow[];
  pendingReplies: CommentReplyRow[];
}

export interface DesignReviewStore {
  db: Database;
  upsertReviewTargetCache(input: ReviewTargetCacheInput): ReviewTargetCacheRow;
  getReviewTargetCache(input: {
    fileKey: string;
    nodeId: string;
    depth: number;
    sourceFingerprint: string;
    now?: string;
  }): ReviewTargetCacheRow | null;
  recordDesignAuditSession(input: DesignAuditSessionInput): { sessionId: string };
  recordDesignAuditFindings(input: {
    sessionId: string;
    findings: DesignAuditFindingInput[];
  }): DesignAuditFindingRow[];
  getDesignAuditReport(input?: {
    sessionId?: string;
    fileKey?: string;
    limit?: number;
  }): DesignAuditReport;
  prepareDesignAuditComments(input: {
    sessionId: string;
    findingIds?: string[];
    limit?: number;
  }): DesignAuditCommentOutboxRow[];
  listPendingDesignAuditComments(input?: {
    sessionId?: string;
    fileKey?: string;
    outboxIds?: string[];
    limit?: number;
  }): DesignAuditCommentOutboxRow[];
  markDesignAuditCommentPosted(input: { outboxId: string; postedCommentId: string }): void;
  markDesignAuditCommentFailed(input: { outboxId: string; error: string }): void;
  recordReviewSession(input: ReviewSessionInput): { sessionId: string };
  getReviewReport(input?: {
    sessionId?: string;
    scope?: string;
    screen?: string;
    limit?: number;
  }): ReviewReport;
  recordDesignAdjustment(input: DesignAdjustmentInput): DesignAdjustmentRow;
  prepareCommentReplies(input: {
    sessionId?: string;
    fileKey?: string;
    commentIds?: string[];
    message: string;
  }): CommentReplyRow[];
  listPendingReplies(input?: {
    sessionId?: string;
    fileKey?: string;
    limit?: number;
  }): CommentReplyRow[];
  markReplyPosted(input: { outboxId: string; postedCommentId: string }): void;
  markReplyFailed(input: { outboxId: string; error: string }): void;
  listPreferenceCandidates(input?: {
    status?: PreferenceCandidateStatus;
    limit?: number;
  }): PreferenceCandidateRow[];
  dismissPreferenceCandidate(input: { key: string }): PreferenceCandidateRow;
  promotePreferenceCandidate(input: {
    key: string;
    scope?: string;
    rule?: string;
  }): DesignPreferenceRow;
  updateDesignPreference(input: {
    key: string;
    rule?: string;
    scope?: string | null;
    status?: DesignPreferenceStatus;
  }): DesignPreferenceRow;
  searchDesignPreferences(input?: {
    scope?: string;
    category?: DesignAdjustmentCategory;
    query?: string;
    limit?: number;
  }): DesignPreferenceRow[];
}

const DESIGN_REVIEW_DB_VERSION = 2;
const REVIEW_TARGET_CACHE_SCHEMA_VERSION = 1;

const nullable = (value: string | undefined): string | null => value ?? null;
const targetToJson = (target: unknown): string | null =>
  target === undefined ? null : JSON.stringify(target);
const jsonString = (value: unknown): string => JSON.stringify(value);
const nullableJson = (value: unknown | undefined): string | null =>
  value === undefined ? null : JSON.stringify(value);

const reviewTargetCacheKey = (input: { fileKey: string; nodeId: string; depth: number }): string =>
  [REVIEW_TARGET_CACHE_SCHEMA_VERSION, input.fileKey, input.nodeId, input.depth].join(":");

const commentMetaForFinding = (
  finding: Pick<DesignAuditFindingInput, "nodeId" | "region">
): unknown | null => {
  if (finding.region !== undefined) {
    return {
      x: finding.region.x,
      y: finding.region.y,
      region_width: finding.region.width,
      region_height: finding.region.height,
      comment_pin_corner: "bottom-right",
    };
  }
  if (finding.nodeId !== undefined) {
    return {
      node_id: finding.nodeId,
      node_offset: { x: 0, y: 0 },
    };
  }
  return null;
};

const confidenceFor = (evidenceCount: number, distinctScreens: number): number =>
  Math.min(0.95, 0.35 + evidenceCount * 0.1 + distinctScreens * 0.05);

const preferenceStopWords = new Set([
  "and",
  "for",
  "from",
  "into",
  "made",
  "make",
  "prefer",
  "reduced",
  "the",
  "this",
  "use",
  "with",
]);

const preferenceSlug = (text: string): string => {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !preferenceStopWords.has(token))
    .slice(0, 6);
  return tokens.length > 0 ? tokens.join("_") : "general";
};

const inferPreferenceCandidate = (
  input: DesignAdjustmentInput
): {
  key: string;
  summary: string;
} => {
  const summary = input.preferenceSummary ?? input.summary;
  return {
    key: input.preferenceKey ?? `${input.category}.${preferenceSlug(summary)}`,
    summary,
  };
};

export function initDesignReviewDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      session_id       TEXT PRIMARY KEY,
      scope            TEXT,
      screen           TEXT,
      file_key         TEXT NOT NULL,
      started_at       TEXT NOT NULL,
      finished_at      TEXT,
      total_fetched    INTEGER NOT NULL,
      mapped_count     INTEGER NOT NULL,
      unmapped_count   INTEGER NOT NULL,
      skipped_resolved INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_comments (
      file_key    TEXT NOT NULL,
      comment_id  TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      scope       TEXT,
      screen      TEXT,
      parent_id   TEXT,
      node_id     TEXT,
      target_json TEXT,
      message     TEXT NOT NULL,
      author      TEXT,
      status      TEXT NOT NULL CHECK (status IN ('open','fixed','replied','needs-decision','unmapped','wont-fix','already-resolved')),
      created_at  TEXT,
      resolved_at TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (file_key, comment_id)
    );

    CREATE INDEX IF NOT EXISTS review_comments_session_idx ON review_comments (session_id);
    CREATE INDEX IF NOT EXISTS review_comments_status_idx ON review_comments (status);

    CREATE TABLE IF NOT EXISTS design_adjustments (
      adjustment_id  TEXT PRIMARY KEY,
      session_id     TEXT,
      scope          TEXT,
      screen         TEXT,
      file_key       TEXT,
      comment_id     TEXT,
      node_id        TEXT,
      category       TEXT NOT NULL,
      summary        TEXT NOT NULL,
      preference_key TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS design_adjustments_session_idx ON design_adjustments (session_id);
    CREATE INDEX IF NOT EXISTS design_adjustments_preference_idx ON design_adjustments (preference_key);

    CREATE TABLE IF NOT EXISTS comment_outbox (
      outbox_id         TEXT PRIMARY KEY,
      session_id        TEXT,
      file_key          TEXT NOT NULL,
      comment_id        TEXT NOT NULL,
      message           TEXT NOT NULL,
      status            TEXT NOT NULL CHECK (status IN ('pending','posted','failed','skipped')),
      posted_comment_id TEXT,
      error             TEXT,
      created_at        TEXT NOT NULL,
      posted_at         TEXT
    );

    CREATE INDEX IF NOT EXISTS comment_outbox_status_idx ON comment_outbox (status);
    CREATE INDEX IF NOT EXISTS comment_outbox_session_idx ON comment_outbox (session_id);

    CREATE TABLE IF NOT EXISTS design_preference_candidates (
      key              TEXT PRIMARY KEY,
      category         TEXT NOT NULL,
      summary          TEXT NOT NULL,
      rule             TEXT NOT NULL,
      evidence_count   INTEGER NOT NULL,
      distinct_screens INTEGER NOT NULL,
      confidence       REAL NOT NULL,
      status           TEXT NOT NULL CHECK (status IN ('candidate','promoted','dismissed')),
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preference_candidate_evidence (
      candidate_key TEXT NOT NULL,
      adjustment_id TEXT NOT NULL,
      comment_id    TEXT,
      scope         TEXT,
      screen        TEXT,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (candidate_key, adjustment_id)
    );

    CREATE TABLE IF NOT EXISTS design_preferences (
      key            TEXT PRIMARY KEY,
      category       TEXT NOT NULL,
      rule           TEXT NOT NULL,
      scope          TEXT,
      status         TEXT NOT NULL CHECK (status IN ('active','inactive')),
      evidence_count INTEGER NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_target_cache (
      cache_key          TEXT PRIMARY KEY,
      schema_version     INTEGER NOT NULL,
      file_key           TEXT NOT NULL,
      node_id            TEXT NOT NULL,
      depth              INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      summary_json       TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      expires_at         TEXT NOT NULL,
      last_used_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS review_target_cache_lookup_idx
      ON review_target_cache (file_key, node_id, depth);

    CREATE TABLE IF NOT EXISTS design_audit_sessions (
      session_id    TEXT PRIMARY KEY,
      source        TEXT NOT NULL CHECK (source IN ('figma')),
      file_key      TEXT NOT NULL,
      node_id       TEXT NOT NULL,
      target_kind   TEXT NOT NULL CHECK (target_kind IN ('page','section','frame','component','unknown')),
      target_name   TEXT NOT NULL,
      figma_url     TEXT NOT NULL,
      scope         TEXT,
      screen        TEXT,
      brief_json    TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS design_audit_sessions_target_idx
      ON design_audit_sessions (file_key, node_id, updated_at);

    CREATE TABLE IF NOT EXISTS design_audit_findings (
      finding_id        TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      category          TEXT NOT NULL,
      severity          TEXT NOT NULL CHECK (severity IN ('critical','high','medium','polish')),
      confidence        TEXT NOT NULL CHECK (confidence IN ('observed','inferred','needs-decision')),
      title             TEXT NOT NULL,
      observation       TEXT NOT NULL,
      rationale         TEXT NOT NULL,
      recommendation    TEXT NOT NULL,
      node_id           TEXT,
      region_json       TEXT,
      commentable       INTEGER NOT NULL,
      suggested_comment TEXT,
      status            TEXT NOT NULL CHECK (status IN ('open','prepared','posted','dismissed','fixed')),
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES design_audit_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS design_audit_findings_session_idx
      ON design_audit_findings (session_id, status);

    CREATE TABLE IF NOT EXISTS design_audit_comment_outbox (
      outbox_id         TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      finding_id        TEXT NOT NULL,
      file_key          TEXT NOT NULL,
      message           TEXT NOT NULL,
      client_meta_json  TEXT,
      status            TEXT NOT NULL CHECK (status IN ('pending','posted','failed','skipped')),
      posted_comment_id TEXT,
      error             TEXT,
      created_at        TEXT NOT NULL,
      posted_at         TEXT,
      FOREIGN KEY(session_id) REFERENCES design_audit_sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(finding_id) REFERENCES design_audit_findings(finding_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS design_audit_comment_outbox_status_idx
      ON design_audit_comment_outbox (status, session_id);
  `);
  db.exec(`PRAGMA user_version = ${DESIGN_REVIEW_DB_VERSION}`);
}

const rowToReviewSession = (row: Record<string, unknown>): ReviewSessionRow => ({
  sessionId: String(row.sessionId),
  scope: row.scope === null ? null : String(row.scope),
  screen: row.screen === null ? null : String(row.screen),
  fileKey: String(row.fileKey),
  startedAt: String(row.startedAt),
  finishedAt: row.finishedAt === null ? null : String(row.finishedAt),
  totalFetched: Number(row.totalFetched),
  mappedCount: Number(row.mappedCount),
  unmappedCount: Number(row.unmappedCount),
  skippedResolved: Number(row.skippedResolved),
});

const buildStatusCounts = (comments: ReviewCommentRow[]): ReviewReport["summary"] => {
  const count = (status: ReviewCommentStatus): number =>
    comments.filter((comment) => comment.status === status).length;
  return {
    totalComments: comments.length,
    open: count("open"),
    fixed: count("fixed"),
    replied: count("replied"),
    needsDecision: count("needs-decision"),
    unmapped: count("unmapped"),
    wontFix: count("wont-fix"),
    alreadyResolved: count("already-resolved"),
    pendingReplies: 0,
    adjustments: 0,
  };
};

const rowToComment = (row: Record<string, unknown>): ReviewCommentRow => ({
  commentId: String(row.commentId),
  sessionId: String(row.sessionId),
  scope: row.scope === null ? null : String(row.scope),
  screen: row.screen === null ? null : String(row.screen),
  fileKey: String(row.fileKey),
  parentId: row.parentId === null ? null : String(row.parentId),
  nodeId: row.nodeId === null ? null : String(row.nodeId),
  targetJson: row.targetJson === null ? null : String(row.targetJson),
  message: String(row.message),
  author: row.author === null ? null : String(row.author),
  status: row.status as ReviewCommentStatus,
  createdAt: row.createdAt === null ? null : String(row.createdAt),
  resolvedAt: row.resolvedAt === null ? null : String(row.resolvedAt),
  updatedAt: String(row.updatedAt),
});

const rowToAdjustment = (row: Record<string, unknown>): DesignAdjustmentRow => ({
  adjustmentId: String(row.adjustmentId),
  sessionId: row.sessionId === null ? null : String(row.sessionId),
  scope: row.scope === null ? null : String(row.scope),
  screen: row.screen === null ? null : String(row.screen),
  fileKey: row.fileKey === null ? null : String(row.fileKey),
  commentId: row.commentId === null ? null : String(row.commentId),
  nodeId: row.nodeId === null ? null : String(row.nodeId),
  category: row.category as DesignAdjustmentCategory,
  summary: String(row.summary),
  preferenceKey: row.preferenceKey === null ? null : String(row.preferenceKey),
  createdAt: String(row.createdAt),
});

const rowToReply = (row: Record<string, unknown>): CommentReplyRow => ({
  outboxId: String(row.outboxId),
  sessionId: row.sessionId === null ? null : String(row.sessionId),
  fileKey: String(row.fileKey),
  commentId: String(row.commentId),
  message: String(row.message),
  status: row.status as ReplyStatus,
  postedCommentId: row.postedCommentId === null ? null : String(row.postedCommentId),
  error: row.error === null ? null : String(row.error),
  createdAt: String(row.createdAt),
  postedAt: row.postedAt === null ? null : String(row.postedAt),
});

const rowToCandidate = (row: Record<string, unknown>): PreferenceCandidateRow => ({
  key: String(row.key),
  category: row.category as DesignAdjustmentCategory,
  summary: String(row.summary),
  rule: String(row.rule),
  evidenceCount: Number(row.evidenceCount),
  distinctScreens: Number(row.distinctScreens),
  confidence: Number(row.confidence),
  status: row.status as PreferenceCandidateStatus,
  updatedAt: String(row.updatedAt),
});

const rowToPreference = (row: Record<string, unknown>): DesignPreferenceRow => ({
  key: String(row.key),
  category: row.category as DesignAdjustmentCategory,
  rule: String(row.rule),
  scope: row.scope === null ? null : String(row.scope),
  status: row.status as DesignPreferenceStatus,
  evidenceCount: Number(row.evidenceCount),
  createdAt: String(row.createdAt),
  updatedAt: String(row.updatedAt),
});

const rowToReviewTargetCache = (row: Record<string, unknown>): ReviewTargetCacheRow => ({
  cacheKey: String(row.cacheKey),
  schemaVersion: Number(row.schemaVersion),
  fileKey: String(row.fileKey),
  nodeId: String(row.nodeId),
  depth: Number(row.depth),
  sourceFingerprint: String(row.sourceFingerprint),
  summaryJson: String(row.summaryJson),
  createdAt: String(row.createdAt),
  expiresAt: String(row.expiresAt),
  lastUsedAt: String(row.lastUsedAt),
});

const rowToDesignAuditSession = (row: Record<string, unknown>): DesignAuditSessionRow => ({
  sessionId: String(row.sessionId),
  source: "figma",
  fileKey: String(row.fileKey),
  nodeId: String(row.nodeId),
  targetKind: row.targetKind as DesignAuditTargetKind,
  targetName: String(row.targetName),
  figmaUrl: String(row.figmaUrl),
  scope: row.scope === null ? null : String(row.scope),
  screen: row.screen === null ? null : String(row.screen),
  briefJson: String(row.briefJson),
  evidenceJson: String(row.evidenceJson),
  startedAt: String(row.startedAt),
  updatedAt: String(row.updatedAt),
});

const rowToDesignAuditFinding = (row: Record<string, unknown>): DesignAuditFindingRow => ({
  findingId: String(row.findingId),
  sessionId: String(row.sessionId),
  category: row.category as DesignAuditFindingCategory,
  severity: row.severity as DesignAuditFindingSeverity,
  confidence: row.confidence as DesignAuditFindingConfidence,
  title: String(row.title),
  observation: String(row.observation),
  rationale: String(row.rationale),
  recommendation: String(row.recommendation),
  nodeId: row.nodeId === null ? undefined : String(row.nodeId),
  region: row.regionJson === null ? undefined : JSON.parse(String(row.regionJson)),
  regionJson: row.regionJson === null ? null : String(row.regionJson),
  commentable: Number(row.commentable) === 1,
  suggestedComment: row.suggestedComment === null ? undefined : String(row.suggestedComment),
  status: row.status as DesignAuditFindingStatus,
  createdAt: String(row.createdAt),
  updatedAt: String(row.updatedAt),
});

const rowToDesignAuditComment = (row: Record<string, unknown>): DesignAuditCommentOutboxRow => ({
  outboxId: String(row.outboxId),
  sessionId: String(row.sessionId),
  findingId: String(row.findingId),
  fileKey: String(row.fileKey),
  message: String(row.message),
  clientMetaJson: row.clientMetaJson === null ? null : String(row.clientMetaJson),
  status: row.status as ReplyStatus,
  postedCommentId: row.postedCommentId === null ? null : String(row.postedCommentId),
  error: row.error === null ? null : String(row.error),
  createdAt: String(row.createdAt),
  postedAt: row.postedAt === null ? null : String(row.postedAt),
});

const emptyDesignAuditReport = (): DesignAuditReport => ({
  session: null,
  summary: {
    totalFindings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    polish: 0,
    open: 0,
    preparedComments: 0,
    postedComments: 0,
  },
  findings: [],
  pendingComments: [],
});

const designAuditSummary = (
  findings: DesignAuditFindingRow[],
  pendingComments: DesignAuditCommentOutboxRow[],
  postedComments: number
): DesignAuditReport["summary"] => {
  const severityCount = (severity: DesignAuditFindingSeverity): number =>
    findings.filter((finding) => finding.severity === severity).length;
  return {
    totalFindings: findings.length,
    critical: severityCount("critical"),
    high: severityCount("high"),
    medium: severityCount("medium"),
    polish: severityCount("polish"),
    open: findings.filter((finding) => finding.status === "open").length,
    preparedComments: pendingComments.length,
    postedComments,
  };
};

class SqliteDesignReviewStore implements DesignReviewStore {
  constructor(public readonly db: Database) {}

  upsertReviewTargetCache(input: ReviewTargetCacheInput): ReviewTargetCacheRow {
    const ts = input.createdAt ?? nowIso();
    const cacheKey = reviewTargetCacheKey(input);
    this.db
      .prepare(`
      INSERT INTO review_target_cache (
        cache_key, schema_version, file_key, node_id, depth, source_fingerprint,
        summary_json, created_at, expires_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        source_fingerprint = excluded.source_fingerprint,
        summary_json = excluded.summary_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        last_used_at = excluded.last_used_at
    `)
      .run(
        cacheKey,
        REVIEW_TARGET_CACHE_SCHEMA_VERSION,
        input.fileKey,
        input.nodeId,
        input.depth,
        input.sourceFingerprint,
        jsonString(input.summary),
        ts,
        input.expiresAt,
        ts
      );
    const cache = this.getReviewTargetCache({
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      depth: input.depth,
      sourceFingerprint: input.sourceFingerprint,
      now: ts,
    });
    if (cache === null) {
      throw new Error("Expected review target cache after upsert.");
    }
    return cache;
  }

  getReviewTargetCache(input: {
    fileKey: string;
    nodeId: string;
    depth: number;
    sourceFingerprint: string;
    now?: string;
  }): ReviewTargetCacheRow | null {
    const row = this.db
      .prepare(`
      SELECT
        cache_key as cacheKey, schema_version as schemaVersion, file_key as fileKey,
        node_id as nodeId, depth, source_fingerprint as sourceFingerprint,
        summary_json as summaryJson, created_at as createdAt, expires_at as expiresAt,
        last_used_at as lastUsedAt
      FROM review_target_cache
      WHERE cache_key = ?
        AND schema_version = ?
        AND source_fingerprint = ?
        AND expires_at > ?
    `)
      .get(
        reviewTargetCacheKey(input),
        REVIEW_TARGET_CACHE_SCHEMA_VERSION,
        input.sourceFingerprint,
        input.now ?? nowIso()
      ) as Record<string, unknown> | undefined;
    if (!row) return null;
    const usedAt = input.now ?? nowIso();
    this.db
      .prepare(`
      UPDATE review_target_cache
      SET last_used_at = ?
      WHERE cache_key = ?
    `)
      .run(usedAt, String(row.cacheKey));
    return rowToReviewTargetCache({ ...row, lastUsedAt: usedAt });
  }

  recordDesignAuditSession(input: DesignAuditSessionInput): { sessionId: string } {
    const sessionId = uuid();
    const ts = nowIso();
    this.db
      .prepare(`
      INSERT INTO design_audit_sessions (
        session_id, source, file_key, node_id, target_kind, target_name,
        figma_url, scope, screen, brief_json, evidence_json, started_at, updated_at
      ) VALUES (?, 'figma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        sessionId,
        input.target.fileKey,
        input.target.nodeId,
        input.target.targetKind,
        input.target.targetName,
        input.target.figmaUrl,
        nullable(input.target.scope),
        nullable(input.target.screen),
        jsonString(input.brief),
        jsonString(input.evidence),
        ts,
        ts
      );
    return { sessionId };
  }

  recordDesignAuditFindings(input: {
    sessionId: string;
    findings: DesignAuditFindingInput[];
  }): DesignAuditFindingRow[] {
    const ts = nowIso();
    return withTransaction(this.db, () =>
      input.findings.map((finding) => {
        const findingId = uuid();
        this.db
          .prepare(`
          INSERT INTO design_audit_findings (
            finding_id, session_id, category, severity, confidence, title,
            observation, rationale, recommendation, node_id, region_json,
            commentable, suggested_comment, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `)
          .run(
            findingId,
            input.sessionId,
            finding.category,
            finding.severity,
            finding.confidence,
            finding.title,
            finding.observation,
            finding.rationale,
            finding.recommendation,
            nullable(finding.nodeId),
            nullableJson(finding.region),
            finding.commentable ? 1 : 0,
            nullable(finding.suggestedComment),
            ts,
            ts
          );
        return {
          ...finding,
          findingId,
          sessionId: input.sessionId,
          status: "open" as const,
          regionJson: nullableJson(finding.region),
          createdAt: ts,
          updatedAt: ts,
        };
      })
    );
  }

  getDesignAuditReport(
    input: { sessionId?: string; fileKey?: string; limit?: number } = {}
  ): DesignAuditReport {
    const session = this.findDesignAuditSession(input);
    if (!session) return emptyDesignAuditReport();

    const limit = input.limit ?? 25;
    const findings = asSqlRows(
      this.db
        .prepare(`
      SELECT
        finding_id as findingId, session_id as sessionId, category, severity,
        confidence, title, observation, rationale, recommendation,
        node_id as nodeId, region_json as regionJson, commentable,
        suggested_comment as suggestedComment, status, created_at as createdAt,
        updated_at as updatedAt
      FROM design_audit_findings
      WHERE session_id = ?
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        created_at
      LIMIT ?
    `)
        .all(session.sessionId, limit)
    ).map(rowToDesignAuditFinding);
    const pendingComments = this.listPendingDesignAuditComments({
      sessionId: session.sessionId,
      limit,
    });
    const posted = this.db
      .prepare(`
      SELECT COUNT(*) as count
      FROM design_audit_comment_outbox
      WHERE session_id = ? AND status = 'posted'
    `)
      .get(session.sessionId) as { count: number };

    return {
      session,
      summary: designAuditSummary(findings, pendingComments, Number(posted.count)),
      findings,
      pendingComments,
    };
  }

  prepareDesignAuditComments(input: {
    sessionId: string;
    findingIds?: string[];
    limit?: number;
  }): DesignAuditCommentOutboxRow[] {
    const findings = this.commentableFindings(input);
    const session = this.findDesignAuditSession({ sessionId: input.sessionId });
    if (!session) {
      throw new KotikitError(
        "I couldn't find that design review session.",
        "Start a design review before preparing Figma comments."
      );
    }
    const ts = nowIso();
    return withTransaction(this.db, () =>
      findings.map((finding) => {
        const existing = this.db
          .prepare(`
          SELECT
            outbox_id as outboxId, session_id as sessionId, finding_id as findingId,
            file_key as fileKey, message, client_meta_json as clientMetaJson,
            status, posted_comment_id as postedCommentId, error,
            created_at as createdAt, posted_at as postedAt
          FROM design_audit_comment_outbox
          WHERE finding_id = ? AND status = 'pending'
        `)
          .get(finding.findingId) as Record<string, unknown> | undefined;
        if (existing) return rowToDesignAuditComment(existing);

        const outboxId = uuid();
        const meta = commentMetaForFinding(finding);
        this.db
          .prepare(`
          INSERT INTO design_audit_comment_outbox (
            outbox_id, session_id, finding_id, file_key, message, client_meta_json,
            status, posted_comment_id, error, created_at, posted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)
        `)
          .run(
            outboxId,
            input.sessionId,
            finding.findingId,
            session.fileKey,
            finding.suggestedComment ?? finding.recommendation,
            nullableJson(meta),
            ts
          );
        this.db
          .prepare(`
          UPDATE design_audit_findings
          SET status = 'prepared', updated_at = ?
          WHERE finding_id = ? AND status = 'open'
        `)
          .run(ts, finding.findingId);
        return {
          outboxId,
          sessionId: input.sessionId,
          findingId: finding.findingId,
          fileKey: session.fileKey,
          message: finding.suggestedComment ?? finding.recommendation,
          clientMetaJson: nullableJson(meta),
          status: "pending" as const,
          postedCommentId: null,
          error: null,
          createdAt: ts,
          postedAt: null,
        };
      })
    );
  }

  listPendingDesignAuditComments(
    input: { sessionId?: string; fileKey?: string; outboxIds?: string[]; limit?: number } = {}
  ): DesignAuditCommentOutboxRow[] {
    const conditions = ["status = 'pending'"];
    const bindings: (string | number)[] = [];
    if (input.sessionId !== undefined) {
      conditions.push("session_id = ?");
      bindings.push(input.sessionId);
    }
    if (input.fileKey !== undefined) {
      conditions.push("file_key = ?");
      bindings.push(input.fileKey);
    }
    if (input.outboxIds !== undefined && input.outboxIds.length > 0) {
      conditions.push(`outbox_id IN (${input.outboxIds.map(() => "?").join(",")})`);
      bindings.push(...input.outboxIds);
    }
    bindings.push(input.limit ?? 25);
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        outbox_id as outboxId, session_id as sessionId, finding_id as findingId,
        file_key as fileKey, message, client_meta_json as clientMetaJson,
        status, posted_comment_id as postedCommentId, error,
        created_at as createdAt, posted_at as postedAt
      FROM design_audit_comment_outbox
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at
      LIMIT ?
    `)
        .all(...bindings)
    ).map(rowToDesignAuditComment);
  }

  markDesignAuditCommentPosted(input: { outboxId: string; postedCommentId: string }): void {
    const ts = nowIso();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
        UPDATE design_audit_comment_outbox
        SET status = 'posted', posted_comment_id = ?, error = NULL, posted_at = ?
        WHERE outbox_id = ?
      `)
        .run(input.postedCommentId, ts, input.outboxId);
      this.db
        .prepare(`
        UPDATE design_audit_findings
        SET status = 'posted', updated_at = ?
        WHERE finding_id IN (
          SELECT finding_id FROM design_audit_comment_outbox WHERE outbox_id = ?
        )
      `)
        .run(ts, input.outboxId);
    });
  }

  markDesignAuditCommentFailed(input: { outboxId: string; error: string }): void {
    this.db
      .prepare(`
      UPDATE design_audit_comment_outbox
      SET status = 'failed', error = ?, posted_at = ?
      WHERE outbox_id = ?
    `)
      .run(input.error, nowIso(), input.outboxId);
  }

  recordReviewSession(input: ReviewSessionInput): { sessionId: string } {
    const sessionId = uuid();
    const ts = nowIso();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
        INSERT INTO review_sessions (
          session_id, scope, screen, file_key, started_at, finished_at,
          total_fetched, mapped_count, unmapped_count, skipped_resolved
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          sessionId,
          nullable(input.scope),
          nullable(input.screen),
          input.fileKey,
          ts,
          ts,
          input.totalFetched,
          input.mappedCount,
          input.unmappedCount,
          input.skippedResolved
        );
      input.comments.forEach((comment) => {
        this.db
          .prepare(`
          INSERT INTO review_comments (
            file_key, comment_id, session_id, scope, screen, parent_id, node_id,
            target_json, message, author, status, created_at, resolved_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(file_key, comment_id) DO UPDATE SET
            session_id = excluded.session_id,
            scope = excluded.scope,
            screen = excluded.screen,
            parent_id = excluded.parent_id,
            node_id = excluded.node_id,
            target_json = excluded.target_json,
            message = excluded.message,
            author = excluded.author,
            status = excluded.status,
            created_at = excluded.created_at,
            resolved_at = excluded.resolved_at,
            updated_at = excluded.updated_at
        `)
          .run(
            comment.fileKey,
            comment.commentId,
            sessionId,
            nullable(input.scope),
            nullable(input.screen),
            nullable(comment.parentId),
            nullable(comment.nodeId),
            targetToJson(comment.target),
            comment.message,
            nullable(comment.author),
            comment.status,
            nullable(comment.createdAt),
            nullable(comment.resolvedAt),
            ts
          );
      });
    });
    return { sessionId };
  }

  getReviewReport(
    input: { sessionId?: string; scope?: string; screen?: string; limit?: number } = {}
  ): ReviewReport {
    const limit = input.limit ?? 25;
    const session = this.findSession(input);
    if (!session) {
      return {
        session: null,
        summary: {
          totalComments: 0,
          open: 0,
          fixed: 0,
          replied: 0,
          needsDecision: 0,
          unmapped: 0,
          wontFix: 0,
          alreadyResolved: 0,
          pendingReplies: 0,
          adjustments: 0,
        },
        comments: [],
        adjustments: [],
        pendingReplies: [],
      };
    }
    const comments = asSqlRows(
      this.db
        .prepare(`
      SELECT
        comment_id as commentId, session_id as sessionId, scope, screen,
        file_key as fileKey, parent_id as parentId, node_id as nodeId,
        target_json as targetJson, message, author, status,
        created_at as createdAt, resolved_at as resolvedAt, updated_at as updatedAt
      FROM review_comments
      WHERE session_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `)
        .all(session.sessionId, limit)
    ).map(rowToComment);
    const adjustments = asSqlRows(
      this.db
        .prepare(`
      SELECT
        adjustment_id as adjustmentId, session_id as sessionId, scope, screen,
        file_key as fileKey, comment_id as commentId, node_id as nodeId,
        category, summary, preference_key as preferenceKey, created_at as createdAt
      FROM design_adjustments
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
        .all(session.sessionId, limit)
    ).map(rowToAdjustment);
    const pendingReplies = this.listPendingReplies({ sessionId: session.sessionId, limit });
    return {
      session,
      summary: {
        ...buildStatusCounts(comments),
        pendingReplies: pendingReplies.length,
        adjustments: adjustments.length,
      },
      comments,
      adjustments,
      pendingReplies,
    };
  }

  recordDesignAdjustment(input: DesignAdjustmentInput): DesignAdjustmentRow {
    const adjustmentId = uuid();
    const ts = nowIso();
    const candidate = inferPreferenceCandidate(input);
    const row: DesignAdjustmentRow = {
      adjustmentId,
      sessionId: input.sessionId ?? null,
      scope: input.scope ?? null,
      screen: input.screen ?? null,
      fileKey: input.fileKey ?? null,
      commentId: input.commentId ?? null,
      nodeId: input.nodeId ?? null,
      category: input.category,
      summary: input.summary,
      preferenceKey: candidate.key,
      createdAt: ts,
    };
    withTransaction(this.db, () => {
      this.db
        .prepare(`
        INSERT INTO design_adjustments (
          adjustment_id, session_id, scope, screen, file_key, comment_id, node_id,
          category, summary, preference_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          adjustmentId,
          row.sessionId,
          row.scope,
          row.screen,
          row.fileKey,
          row.commentId,
          row.nodeId,
          row.category,
          row.summary,
          row.preferenceKey,
          row.createdAt
        );
      if (input.commentId && input.fileKey) {
        this.db
          .prepare(`
          UPDATE review_comments
          SET status = 'fixed', updated_at = ?
          WHERE file_key = ? AND comment_id = ? AND status NOT IN ('replied','wont-fix','already-resolved')
        `)
          .run(ts, input.fileKey, input.commentId);
      }
      this.upsertPreferenceCandidate({
        adjustmentId,
        commentId: input.commentId,
        scope: input.scope,
        screen: input.screen,
        category: input.category,
        key: candidate.key,
        summary: candidate.summary,
        ts,
      });
    });
    return row;
  }

  prepareCommentReplies(input: {
    sessionId?: string;
    fileKey?: string;
    commentIds?: string[];
    message: string;
  }): CommentReplyRow[] {
    const comments = this.commentsForReplyPreparation(input);
    const ts = nowIso();
    return withTransaction(this.db, () =>
      comments.map((comment) => {
        const existing = this.db
          .prepare(`
          SELECT
            outbox_id as outboxId, session_id as sessionId, file_key as fileKey,
            comment_id as commentId, message, status, posted_comment_id as postedCommentId,
            error, created_at as createdAt, posted_at as postedAt
          FROM comment_outbox
          WHERE file_key = ? AND comment_id = ? AND message = ? AND status = 'pending'
        `)
          .get(comment.fileKey, comment.commentId, input.message) as
          | Record<string, unknown>
          | undefined;
        if (existing) return rowToReply(existing);
        const outboxId = uuid();
        this.db
          .prepare(`
          INSERT INTO comment_outbox (
            outbox_id, session_id, file_key, comment_id, message, status,
            posted_comment_id, error, created_at, posted_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)
        `)
          .run(outboxId, comment.sessionId, comment.fileKey, comment.commentId, input.message, ts);
        return {
          outboxId,
          sessionId: comment.sessionId,
          fileKey: comment.fileKey,
          commentId: comment.commentId,
          message: input.message,
          status: "pending" as const,
          postedCommentId: null,
          error: null,
          createdAt: ts,
          postedAt: null,
        };
      })
    );
  }

  listPendingReplies(
    input: { sessionId?: string; fileKey?: string; limit?: number } = {}
  ): CommentReplyRow[] {
    const conditions = ["status = 'pending'"];
    const bindings: (string | number)[] = [];
    if (input.sessionId) {
      conditions.push("session_id = ?");
      bindings.push(input.sessionId);
    }
    if (input.fileKey) {
      conditions.push("file_key = ?");
      bindings.push(input.fileKey);
    }
    bindings.push(input.limit ?? 25);
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        outbox_id as outboxId, session_id as sessionId, file_key as fileKey,
        comment_id as commentId, message, status, posted_comment_id as postedCommentId,
        error, created_at as createdAt, posted_at as postedAt
      FROM comment_outbox
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at
      LIMIT ?
    `)
        .all(...bindings)
    ).map(rowToReply);
  }

  markReplyPosted(input: { outboxId: string; postedCommentId: string }): void {
    const ts = nowIso();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
        UPDATE comment_outbox
        SET status = 'posted', posted_comment_id = ?, error = NULL, posted_at = ?
        WHERE outbox_id = ?
      `)
        .run(input.postedCommentId, ts, input.outboxId);
      this.db
        .prepare(`
        UPDATE review_comments
        SET status = 'replied', updated_at = ?
        WHERE (file_key, comment_id) IN (
          SELECT file_key, comment_id FROM comment_outbox WHERE outbox_id = ?
        )
      `)
        .run(ts, input.outboxId);
    });
  }

  markReplyFailed(input: { outboxId: string; error: string }): void {
    this.db
      .prepare(`
      UPDATE comment_outbox
      SET status = 'failed', error = ?, posted_at = ?
      WHERE outbox_id = ?
    `)
      .run(input.error, nowIso(), input.outboxId);
  }

  listPreferenceCandidates(
    input: { status?: PreferenceCandidateStatus; limit?: number } = {}
  ): PreferenceCandidateRow[] {
    const conditions = input.status ? "WHERE status = ?" : "";
    const bindings = input.status ? [input.status, input.limit ?? 25] : [input.limit ?? 25];
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        key, category, summary, rule, evidence_count as evidenceCount,
        distinct_screens as distinctScreens, confidence, status, updated_at as updatedAt
      FROM design_preference_candidates
      ${conditions}
      ORDER BY evidence_count DESC, updated_at DESC
      LIMIT ?
    `)
        .all(...bindings)
    ).map(rowToCandidate);
  }

  dismissPreferenceCandidate(input: { key: string }): PreferenceCandidateRow {
    const ts = nowIso();
    const result = this.db
      .prepare(`
      UPDATE design_preference_candidates
      SET status = 'dismissed', updated_at = ?
      WHERE key = ?
    `)
      .run(ts, input.key);
    if (result.changes === 0) {
      throw new KotikitError(
        `No design preference candidate found for ${input.key}.`,
        "Review the active memory artifacts before dismissing a candidate."
      );
    }
    const row = this.db
      .prepare(`
      SELECT
        key, category, summary, rule, evidence_count as evidenceCount,
        distinct_screens as distinctScreens, confidence, status, updated_at as updatedAt
      FROM design_preference_candidates
      WHERE key = ?
    `)
      .get(input.key) as Record<string, unknown>;
    return rowToCandidate(row);
  }

  promotePreferenceCandidate(input: {
    key: string;
    scope?: string;
    rule?: string;
  }): DesignPreferenceRow {
    const candidate = this.db
      .prepare(`
      SELECT
        key, category, summary, rule, evidence_count as evidenceCount,
        distinct_screens as distinctScreens, confidence, status, updated_at as updatedAt
      FROM design_preference_candidates
      WHERE key = ?
    `)
      .get(input.key) as Record<string, unknown> | undefined;
    if (!candidate) {
      throw new KotikitError(
        `No design preference candidate found for ${input.key}.`,
        "Run a review pass and record adjustments with preferenceKey first."
      );
    }
    const parsed = rowToCandidate(candidate);
    const ts = nowIso();
    const rule = input.rule ?? parsed.rule;
    withTransaction(this.db, () => {
      this.db
        .prepare(`
        INSERT INTO design_preferences (
          key, category, rule, scope, status, evidence_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          category = excluded.category,
          rule = excluded.rule,
          scope = excluded.scope,
          status = 'active',
          evidence_count = excluded.evidence_count,
          updated_at = excluded.updated_at
      `)
        .run(
          parsed.key,
          parsed.category,
          rule,
          nullable(input.scope),
          parsed.evidenceCount,
          ts,
          ts
        );
      this.db
        .prepare(`
        UPDATE design_preference_candidates
        SET status = 'promoted', updated_at = ?
        WHERE key = ?
      `)
        .run(ts, parsed.key);
    });
    return {
      key: parsed.key,
      category: parsed.category,
      rule,
      scope: input.scope ?? null,
      status: "active",
      evidenceCount: parsed.evidenceCount,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  updateDesignPreference(input: {
    key: string;
    rule?: string;
    scope?: string | null;
    status?: DesignPreferenceStatus;
  }): DesignPreferenceRow {
    const existing = this.db
      .prepare(`
      SELECT
        key, category, rule, scope, status, evidence_count as evidenceCount,
        created_at as createdAt, updated_at as updatedAt
      FROM design_preferences
      WHERE key = ?
    `)
      .get(input.key) as Record<string, unknown> | undefined;
    if (!existing) {
      throw new KotikitError(
        `No design preference found for ${input.key}.`,
        "Promote a candidate before editing or deactivating it."
      );
    }

    const parsed = rowToPreference(existing);
    const ts = nowIso();
    const next = {
      rule: input.rule ?? parsed.rule,
      scope: input.scope !== undefined ? input.scope : parsed.scope,
      status: input.status ?? parsed.status,
    };
    this.db
      .prepare(`
      UPDATE design_preferences
      SET rule = ?, scope = ?, status = ?, updated_at = ?
      WHERE key = ?
    `)
      .run(next.rule, next.scope, next.status, ts, input.key);

    return {
      ...parsed,
      ...next,
      updatedAt: ts,
    };
  }

  searchDesignPreferences(
    input: {
      scope?: string;
      category?: DesignAdjustmentCategory;
      query?: string;
      limit?: number;
    } = {}
  ): DesignPreferenceRow[] {
    const conditions = ["status = 'active'"];
    const bindings: (string | number)[] = [];
    if (input.scope) {
      conditions.push("(scope IS NULL OR scope = ?)");
      bindings.push(input.scope);
    }
    if (input.category) {
      conditions.push("category = ?");
      bindings.push(input.category);
    }
    if (input.query) {
      conditions.push("(rule LIKE ? OR key LIKE ?)");
      bindings.push(`%${input.query}%`, `%${input.query}%`);
    }
    bindings.push(input.limit ?? 25);
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        key, category, rule, scope, status, evidence_count as evidenceCount,
        created_at as createdAt, updated_at as updatedAt
      FROM design_preferences
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `)
        .all(...bindings)
    ).map(rowToPreference);
  }

  private findSession(input: {
    sessionId?: string;
    scope?: string;
    screen?: string;
  }): ReviewSessionRow | null {
    if (input.sessionId) {
      const row = this.db
        .prepare(`
        SELECT
          session_id as sessionId, scope, screen, file_key as fileKey,
          started_at as startedAt, finished_at as finishedAt, total_fetched as totalFetched,
          mapped_count as mappedCount, unmapped_count as unmappedCount,
          skipped_resolved as skippedResolved
        FROM review_sessions
        WHERE session_id = ?
      `)
        .get(input.sessionId) as Record<string, unknown> | undefined;
      return row ? rowToReviewSession(row) : null;
    }
    const conditions: string[] = [];
    const bindings: string[] = [];
    if (input.scope) {
      conditions.push("scope = ?");
      bindings.push(input.scope);
    }
    if (input.screen !== undefined) {
      conditions.push("screen = ?");
      bindings.push(input.screen);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare(`
      SELECT
        session_id as sessionId, scope, screen, file_key as fileKey,
        started_at as startedAt, finished_at as finishedAt, total_fetched as totalFetched,
        mapped_count as mappedCount, unmapped_count as unmappedCount,
        skipped_resolved as skippedResolved
      FROM review_sessions
      ${where}
      ORDER BY started_at DESC
      LIMIT 1
    `)
      .get(...bindings) as Record<string, unknown> | undefined;
    return row ? rowToReviewSession(row) : null;
  }

  private findDesignAuditSession(input: {
    sessionId?: string;
    fileKey?: string;
  }): DesignAuditSessionRow | null {
    if (input.sessionId !== undefined) {
      const row = this.db
        .prepare(`
        SELECT
          session_id as sessionId, source, file_key as fileKey, node_id as nodeId,
          target_kind as targetKind, target_name as targetName, figma_url as figmaUrl,
          scope, screen, brief_json as briefJson, evidence_json as evidenceJson,
          started_at as startedAt, updated_at as updatedAt
        FROM design_audit_sessions
        WHERE session_id = ?
      `)
        .get(input.sessionId) as Record<string, unknown> | undefined;
      return row ? rowToDesignAuditSession(row) : null;
    }
    const conditions = input.fileKey !== undefined ? "WHERE file_key = ?" : "";
    const bindings = input.fileKey !== undefined ? [input.fileKey] : [];
    const row = this.db
      .prepare(`
      SELECT
        session_id as sessionId, source, file_key as fileKey, node_id as nodeId,
        target_kind as targetKind, target_name as targetName, figma_url as figmaUrl,
        scope, screen, brief_json as briefJson, evidence_json as evidenceJson,
        started_at as startedAt, updated_at as updatedAt
      FROM design_audit_sessions
      ${conditions}
      ORDER BY updated_at DESC
      LIMIT 1
    `)
      .get(...bindings) as Record<string, unknown> | undefined;
    return row ? rowToDesignAuditSession(row) : null;
  }

  private commentableFindings(input: {
    sessionId: string;
    findingIds?: string[];
    limit?: number;
  }): DesignAuditFindingRow[] {
    const conditions = [
      "session_id = ?",
      "commentable = 1",
      "status IN ('open','prepared')",
      "(suggested_comment IS NOT NULL OR recommendation IS NOT NULL)",
    ];
    const bindings: (string | number)[] = [input.sessionId];
    if (input.findingIds !== undefined && input.findingIds.length > 0) {
      conditions.push(`finding_id IN (${input.findingIds.map(() => "?").join(",")})`);
      bindings.push(...input.findingIds);
    }
    bindings.push(input.limit ?? 12);
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        finding_id as findingId, session_id as sessionId, category, severity,
        confidence, title, observation, rationale, recommendation,
        node_id as nodeId, region_json as regionJson, commentable,
        suggested_comment as suggestedComment, status, created_at as createdAt,
        updated_at as updatedAt
      FROM design_audit_findings
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        created_at
      LIMIT ?
    `)
        .all(...bindings)
    ).map(rowToDesignAuditFinding);
  }

  private commentsForReplyPreparation(input: {
    sessionId?: string;
    fileKey?: string;
    commentIds?: string[];
  }): ReviewCommentRow[] {
    const baseConditions = ["status = 'fixed'"];
    const bindings: string[] = [];
    if (input.sessionId) {
      baseConditions.push("session_id = ?");
      bindings.push(input.sessionId);
    }
    if (input.fileKey) {
      baseConditions.push("file_key = ?");
      bindings.push(input.fileKey);
    }
    if (input.commentIds && input.commentIds.length > 0) {
      baseConditions.push(`comment_id IN (${input.commentIds.map(() => "?").join(",")})`);
      bindings.push(...input.commentIds);
    }
    return asSqlRows(
      this.db
        .prepare(`
      SELECT
        comment_id as commentId, session_id as sessionId, scope, screen,
        file_key as fileKey, parent_id as parentId, node_id as nodeId,
        target_json as targetJson, message, author, status,
        created_at as createdAt, resolved_at as resolvedAt, updated_at as updatedAt
      FROM review_comments
      WHERE ${baseConditions.join(" AND ")}
      ORDER BY updated_at DESC
    `)
        .all(...bindings)
    ).map(rowToComment);
  }

  private upsertPreferenceCandidate(input: {
    adjustmentId: string;
    commentId?: string;
    scope?: string;
    screen?: string;
    category: DesignAdjustmentCategory;
    key: string;
    summary: string;
    ts: string;
  }): void {
    this.db
      .prepare(`
      INSERT OR IGNORE INTO preference_candidate_evidence (
        candidate_key, adjustment_id, comment_id, scope, screen, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(
        input.key,
        input.adjustmentId,
        nullable(input.commentId),
        nullable(input.scope),
        nullable(input.screen),
        input.ts
      );
    const evidence = this.db
      .prepare(`
      SELECT
        COUNT(*) as evidenceCount,
        COUNT(DISTINCT COALESCE(scope, '') || '/' || COALESCE(screen, '')) as distinctScreens
      FROM preference_candidate_evidence
      WHERE candidate_key = ?
    `)
      .get(input.key) as { evidenceCount: number; distinctScreens: number };
    const confidence = confidenceFor(evidence.evidenceCount, evidence.distinctScreens);
    this.db
      .prepare(`
      INSERT INTO design_preference_candidates (
        key, category, summary, rule, evidence_count, distinct_screens,
        confidence, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
      ON CONFLICT(key) DO UPDATE SET
        category = excluded.category,
        summary = excluded.summary,
        rule = excluded.rule,
        evidence_count = excluded.evidence_count,
        distinct_screens = excluded.distinct_screens,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `)
      .run(
        input.key,
        input.category,
        input.summary,
        input.summary,
        evidence.evidenceCount,
        evidence.distinctScreens,
        confidence,
        input.ts
      );
  }
}

export function openDesignReviewDb(root: string): DesignReviewStore {
  const db = openDb(designReviewDbPath(root));
  initDesignReviewDb(db);
  return new SqliteDesignReviewStore(db);
}
