import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  assertCompactGraphState,
  buildContextBudgetReport,
  pruneRawReviewPayloads,
} from "../context-durability.js";

describe("context durability", () => {
  it("reports serialized graph state size", () => {
    const report = buildContextBudgetReport({
      state: {
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "running",
        project: { root: "/tmp/project" },
        artifacts: [],
        errors: [],
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "ContextBudgetReport/v1",
      status: "passed",
      serializedBytes: expect.any(Number),
    });
  });

  it("blocks graph state above the hard budget", () => {
    expect(() =>
      assertCompactGraphState(
        {
          schemaVersion: "KotikitGraphState/v1",
          runId: "run-1",
          flowId: "create-screen",
          flowVersion: "1.0.0",
          graphHash: "hash",
          status: "running",
          project: { root: "/tmp/project" },
          review: { rawPayload: "x".repeat(2_000) },
          artifacts: [],
          errors: [],
        },
        { warningBytes: 512, maxBytes: 1024 }
      )
    ).toThrow(KotikitError);
  });

  it("prunes raw review snapshots after compact comment evidence exists", () => {
    expect(
      pruneRawReviewPayloads({
        commentSnapshot: { comments: [{ id: "comment-1", message: "Long raw payload" }] },
        nodeMap: { nodes: [{ nodeId: "1:2" }] },
        commentEvidenceMap: { schemaVersion: "CommentEvidenceMap/v1" },
      })
    ).toEqual({
      commentSnapshotRef: "comment-evidence-map",
    });
  });
});
