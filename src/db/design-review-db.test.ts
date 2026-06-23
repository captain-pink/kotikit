import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDesignReviewDb } from "./design-review-db.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-design-review-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("design review db", () => {
  it("initializes the SQLite user_version for future migrations", () => {
    const store = openDesignReviewDb(mkTmp());
    const row = store.db.query("PRAGMA user_version").get() as { user_version: number };

    expect(row.user_version).toBe(2);
  });

  it("stores compact review target cache rows and invalidates stale entries", () => {
    const db = openDesignReviewDb(mkTmp());
    db.upsertReviewTargetCache({
      fileKey: "fig-file",
      nodeId: "node-1",
      depth: 1,
      sourceFingerprint: "fresh",
      summary: { nodeId: "node-1", name: "Members", childCount: 12 },
      createdAt: "2026-06-22T10:00:00.000Z",
      expiresAt: "2026-06-22T10:15:00.000Z",
    });

    const fresh = db.getReviewTargetCache({
      fileKey: "fig-file",
      nodeId: "node-1",
      depth: 1,
      sourceFingerprint: "fresh",
      now: "2026-06-22T10:05:00.000Z",
    });
    const staleFingerprint = db.getReviewTargetCache({
      fileKey: "fig-file",
      nodeId: "node-1",
      depth: 1,
      sourceFingerprint: "changed",
      now: "2026-06-22T10:05:00.000Z",
    });
    const expired = db.getReviewTargetCache({
      fileKey: "fig-file",
      nodeId: "node-1",
      depth: 1,
      sourceFingerprint: "fresh",
      now: "2026-06-22T10:20:00.000Z",
    });

    expect(fresh?.summaryJson).toContain("Members");
    expect(staleFingerprint).toBeNull();
    expect(expired).toBeNull();
  });

  it("records standalone design review sessions and structured findings", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordDesignAuditSession({
      target: {
        source: "figma",
        fileKey: "fig-file",
        nodeId: "node-1",
        targetKind: "frame",
        targetName: "Members",
        figmaUrl: "https://www.figma.com/design/fig-file/Test?node-id=node-1",
      },
      brief: {
        surfaceType: "dashboard",
        strictness: "standard",
        reviewGoal: "Review member management UX.",
      },
      evidence: {
        tokenBudget: { maxRegions: 3, returnedRegions: 1, truncatedRegions: 0 },
        targetSummary: { nodeId: "node-1", name: "Members" },
      },
    });

    const findings = db.recordDesignAuditFindings({
      sessionId: session.sessionId,
      findings: [
        {
          category: "layout",
          severity: "high",
          confidence: "observed",
          title: "Actions are misaligned",
          observation: "The row actions do not align with the switch column.",
          rationale: "Rows are harder to scan when repeated controls drift.",
          recommendation: "Place switches and row actions on the same center line.",
          nodeId: "node-1",
          region: { x: 10, y: 20, width: 120, height: 40 },
          commentable: true,
          suggestedComment: "Align the switch and row actions on the same center line.",
        },
      ],
    });
    const report = db.getDesignAuditReport({ sessionId: session.sessionId });

    expect(findings[0]?.findingId).toBeString();
    expect(report.session?.sessionId).toBe(session.sessionId);
    expect(report.summary.totalFindings).toBe(1);
    expect(report.findings[0]?.title).toBe("Actions are misaligned");
  });

  it("prepares and marks posted root Figma comments for review findings", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordDesignAuditSession({
      target: {
        source: "figma",
        fileKey: "fig-file",
        nodeId: "node-1",
        targetKind: "frame",
        targetName: "Members",
        figmaUrl: "https://www.figma.com/design/fig-file/Test?node-id=node-1",
      },
      brief: { strictness: "standard" },
      evidence: {},
    });
    const [finding] = db.recordDesignAuditFindings({
      sessionId: session.sessionId,
      findings: [
        {
          category: "typography",
          severity: "medium",
          confidence: "observed",
          title: "Body text is too low contrast",
          observation: "Secondary text is hard to read.",
          rationale: "Weak contrast slows scanning.",
          recommendation: "Use the design-system secondary text color.",
          nodeId: "node-2",
          region: { x: 100, y: 200, width: 220, height: 48 },
          commentable: true,
          suggestedComment: "Increase contrast for this secondary text.",
        },
      ],
    });

    if (finding === undefined) {
      throw new Error("Expected design audit finding.");
    }
    const [comment] = db.prepareDesignAuditComments({
      sessionId: session.sessionId,
      findingIds: [finding.findingId],
      limit: 10,
    });
    if (comment === undefined) {
      throw new Error("Expected prepared design audit comment.");
    }
    db.markDesignAuditCommentPosted({
      outboxId: comment.outboxId,
      postedCommentId: "figma-comment-1",
    });
    const report = db.getDesignAuditReport({ sessionId: session.sessionId });

    expect(comment?.clientMetaJson).toContain("region_width");
    expect(report.summary.postedComments).toBe(1);
    expect(report.findings[0]?.status).toBe("posted");
  });

  it("records a review session and upserts compact comment rows", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordReviewSession({
      scope: "members",
      screen: "list",
      fileKey: "fig-file",
      totalFetched: 2,
      mappedCount: 1,
      unmappedCount: 1,
      skippedResolved: 0,
      comments: [
        {
          commentId: "c1",
          fileKey: "fig-file",
          message: "Make rows denser",
          author: "Reviewer",
          nodeId: "node-1",
          status: "open",
          target: { componentName: "Table", nodeName: "Members table" },
        },
        {
          commentId: "c2",
          fileKey: "fig-file",
          message: "Outside the generated frame",
          status: "unmapped",
        },
      ],
    });

    const report = db.getReviewReport({ sessionId: session.sessionId });

    expect(report.session?.sessionId).toBe(session.sessionId);
    expect(report.summary.totalComments).toBe(2);
    expect(report.summary.open).toBe(1);
    expect(report.summary.unmapped).toBe(1);
  });

  it("records micro-adjustments and marks linked comments as fixed", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordReviewSession({
      scope: "members",
      screen: "list",
      fileKey: "fig-file",
      totalFetched: 1,
      mappedCount: 1,
      unmappedCount: 0,
      skippedResolved: 0,
      comments: [
        {
          commentId: "c1",
          fileKey: "fig-file",
          message: "Make rows denser",
          status: "open",
          nodeId: "node-1",
        },
      ],
    });

    const adjustment = db.recordDesignAdjustment({
      sessionId: session.sessionId,
      scope: "members",
      screen: "list",
      fileKey: "fig-file",
      commentId: "c1",
      nodeId: "node-1",
      category: "density",
      summary: "Reduced table row height and cell padding.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });
    const report = db.getReviewReport({ sessionId: session.sessionId });
    const candidates = db.listPreferenceCandidates({ limit: 5 });

    expect(adjustment.adjustmentId).toBeString();
    expect(report.summary.fixed).toBe(1);
    expect(report.adjustments[0]?.summary).toContain("row height");
    expect(candidates[0]?.key).toBe("tables.density.compact_rows");
    expect(candidates[0]?.evidenceCount).toBe(1);
  });

  it("prepares pending replies for fixed comments without posting them", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordReviewSession({
      scope: "members",
      fileKey: "fig-file",
      totalFetched: 1,
      mappedCount: 1,
      unmappedCount: 0,
      skippedResolved: 0,
      comments: [{ commentId: "c1", fileKey: "fig-file", message: "Fix", status: "open" }],
    });
    db.recordDesignAdjustment({
      sessionId: session.sessionId,
      scope: "members",
      fileKey: "fig-file",
      commentId: "c1",
      category: "spacing",
      summary: "Adjusted spacing.",
    });

    const prepared = db.prepareCommentReplies({
      sessionId: session.sessionId,
      message: "Fixed in this pass.",
    });
    const report = db.getReviewReport({ sessionId: session.sessionId });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.status).toBe("pending");
    expect(report.summary.pendingReplies).toBe(1);
  });

  it("marks prepared replies as posted and promotes comments to replied", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordReviewSession({
      scope: "members",
      fileKey: "fig-file",
      totalFetched: 1,
      mappedCount: 1,
      unmappedCount: 0,
      skippedResolved: 0,
      comments: [{ commentId: "c1", fileKey: "fig-file", message: "Fix", status: "fixed" }],
    });
    const [reply] = db.prepareCommentReplies({
      sessionId: session.sessionId,
      commentIds: ["c1"],
      message: "Fixed.",
    });
    if (reply === undefined) {
      throw new Error("Expected prepared comment reply.");
    }

    db.markReplyPosted({
      outboxId: reply.outboxId,
      postedCommentId: "reply-1",
    });
    const report = db.getReviewReport({ sessionId: session.sessionId });

    expect(report.summary.replied).toBe(1);
    expect(report.summary.pendingReplies).toBe(0);
  });

  it("promotes a repeated candidate into an active scoped preference", () => {
    const db = openDesignReviewDb(mkTmp());
    const session = db.recordReviewSession({
      scope: "members",
      fileKey: "fig-file",
      totalFetched: 0,
      mappedCount: 0,
      unmappedCount: 0,
      skippedResolved: 0,
      comments: [],
    });
    db.recordDesignAdjustment({
      sessionId: session.sessionId,
      scope: "members",
      fileKey: "fig-file",
      category: "density",
      summary: "Reduced table density.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });

    const preference = db.promotePreferenceCandidate({
      key: "tables.density.compact_rows",
      scope: "admin",
      rule: "For admin tables, prefer compact row density.",
    });
    const active = db.searchDesignPreferences({ scope: "admin", limit: 10 });

    expect(preference.status).toBe("active");
    expect(active[0]?.rule).toContain("compact row density");
  });
});
