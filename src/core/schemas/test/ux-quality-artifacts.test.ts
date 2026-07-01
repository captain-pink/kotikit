import { describe, expect, it } from "bun:test";
import {
  CommentEvidenceMapSchema,
  DraftComponentLifecycleSchema,
  StateMatrixSchema,
  UXEnvelopeSchema,
} from "../artifact.js";
import { KotikitGraphStateSchema } from "../graph-state.js";

describe("UX quality artifact schemas", () => {
  it("validates a UX envelope", () => {
    expect(
      UXEnvelopeSchema.parse({
        schemaVersion: "UXEnvelope/v1",
        screenArchetype: "admin-data-table",
        confidence: "inferred",
        actor: "Workspace admin",
        primaryGoal: "Manage workspace members",
        primaryTask: "Review members and invite teammates",
        secondaryTasks: ["Search members", "Filter by role"],
        dataModel: {
          primaryEntity: "member",
          expectedVolume: "many",
          fields: ["name", "role", "status"],
        },
        permissions: ["invite-member", "change-role"],
        edgeCases: ["empty", "loading", "error", "permission"],
        assumptions: ["Admin screens usually need table management states."],
        sourceRefs: ["https://www.nngroup.com/articles/task-analysis/"],
      })
    ).toMatchObject({ schemaVersion: "UXEnvelope/v1" });
  });

  it("validates a region-scoped state matrix", () => {
    expect(
      StateMatrixSchema.parse({
        schemaVersion: "StateMatrix/v1",
        states: [
          {
            id: "members-loading",
            label: "Loading",
            kind: "loading",
            scope: "region",
            affectedRegion: "members table",
            persistentRegions: ["sidebar", "top bar", "page header"],
            replacementBehavior: "replace-table-body",
            requiredComponents: ["table skeleton row"],
            copy: { title: "Loading members" },
            sourceRefs: ["https://carbondesignsystem.com/patterns/empty-states-pattern/"],
          },
        ],
      })
    ).toMatchObject({ states: [expect.objectContaining({ scope: "region" })] });
  });

  it("validates comment evidence with unmapped comments", () => {
    expect(
      CommentEvidenceMapSchema.parse({
        schemaVersion: "CommentEvidenceMap/v1",
        fileKey: "abc123",
        mappedAt: "2026-07-01T00:00:00.000Z",
        comments: [
          {
            commentId: "comment-1",
            rootCommentId: "comment-1",
            message: "This table state is unclear",
            mappingConfidence: "none",
            mappingStrategy: "unmapped",
            intent: "needs-human-clarification",
            status: "needs-human",
          },
        ],
        unmappedCount: 1,
      })
    ).toMatchObject({ unmappedCount: 1 });
  });

  it("validates draft component lifecycle usage", () => {
    expect(
      DraftComponentLifecycleSchema.parse({
        schemaVersion: "DraftComponentLifecycle/v1",
        sectionName: "Kotikit Draft Components",
        components: [
          {
            draftComponentId: "draft-table-row",
            name: "Table data row",
            reason: "No matching design-system component",
            componentKey: "draft-key",
            componentNodeId: "1:2",
            placement: { pageId: "0:1", sectionName: "Kotikit Draft Components" },
            requiredInstances: 1,
            actualInstances: [{ nodeId: "2:1", stateId: "members-filled" }],
            status: "used",
          },
        ],
      })
    ).toMatchObject({ components: [expect.objectContaining({ status: "used" })] });
  });

  it("allows graph state to hold UX quality artifacts", () => {
    expect(
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "running",
        project: { root: "/tmp/project" },
        uxEnvelope: {
          schemaVersion: "UXEnvelope/v1",
          screenArchetype: "unknown",
          confidence: "low",
          actor: "Designer",
          primaryGoal: "Create a screen",
          primaryTask: "Draft UI",
          secondaryTasks: [],
          dataModel: { primaryEntity: "unknown", expectedVolume: "unknown", fields: [] },
          permissions: [],
          edgeCases: [],
          assumptions: [],
          sourceRefs: [],
        },
        stateMatrix: { schemaVersion: "StateMatrix/v1", states: [] },
        artifacts: [],
        errors: [],
      })
    ).toMatchObject({ uxEnvelope: expect.any(Object), stateMatrix: expect.any(Object) });
  });
});
