import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDesignReviewDb } from "./design-review-db.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-design-review-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("design review db", () => {
  it("initializes the SQLite user_version for future migrations", () => {
    const store = openDesignReviewDb(mkTmp());
    const row = store.db.query("PRAGMA user_version").get() as { user_version: number };

    expect(row.user_version).toBe(1);
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
      comments: [
        { commentId: "c1", fileKey: "fig-file", message: "Fix", status: "open" },
      ],
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
      comments: [
        { commentId: "c1", fileKey: "fig-file", message: "Fix", status: "fixed" },
      ],
    });
    const [reply] = db.prepareCommentReplies({
      sessionId: session.sessionId,
      commentIds: ["c1"],
      message: "Fixed.",
    });

    db.markReplyPosted({
      outboxId: reply!.outboxId,
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
