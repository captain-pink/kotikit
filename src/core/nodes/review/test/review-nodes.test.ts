import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactSchema } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { reviewNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status: "waiting-for-user";
    pendingQuestion: NonNullable<KotikitGraphState["pendingQuestion"]>;
  };
  artifacts?: unknown[];
};

const tmpRoots: string[] = [];

afterEach(() => {
  tmpRoots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("review graph nodes", () => {
  it("collects bounded evidence for an exact Figma target", async () => {
    const result = await runNode("review.collectEvidence", {
      figmaTarget: draftTarget(),
      review: {
        sourceSnapshot: {
          target: {
            nodeId: "10:20",
            name: "Member table",
            type: "FRAME",
            childCount: 3,
          },
          regions: [
            { nodeId: "10:21", name: "Member table", type: "INSTANCE" },
            { nodeId: "10:22", name: "Primary action", type: "INSTANCE" },
            { nodeId: "10:23", name: "Status chip", type: "INSTANCE" },
          ],
        },
      },
    });

    expect(result.statePatch?.review).toMatchObject({
      target: {
        fileKey: "FILE",
        nodeId: "10:20",
        figmaUrl: "https://www.figma.com/design/FILE/Name?node-id=10-20",
      },
      evidence: {
        tokenBudget: { maxRegions: 8, returnedRegions: 3, truncatedRegions: 0 },
        targetSummary: { nodeId: "10:20", name: "Member table", type: "FRAME" },
        regions: [
          { nodeId: "10:21", name: "Member table" },
          { nodeId: "10:22", name: "Primary action" },
          { nodeId: "10:23", name: "Status chip" },
        ],
      },
    });
  });

  it("uses pre-collected review evidence without requiring a bound Figma draft target", async () => {
    const result = await runNode("review.collectEvidence", {
      review: reviewWithEvidence(),
    });

    expect(result.statePatch?.screen).toMatchObject({
      title: "Member table",
      requiredUiParts: ["Member table", "Primary action", "Status chip"],
    });
    expect(result.statePatch?.review).toMatchObject({
      target: { fileKey: "FILE", nodeId: "10:20" },
      evidence: {
        regions: [
          { nodeId: "10:21", name: "Member table" },
          { nodeId: "10:22", name: "Primary action" },
          { nodeId: "10:23", name: "Status chip" },
        ],
      },
    });
  });

  it("fails closed when target evidence has not been seeded", async () => {
    await expect(
      runNode("review.collectEvidence", {
        figmaTarget: draftTarget(),
      })
    ).rejects.toThrow("review evidence");
  });

  it("collects review evidence from a compact comment evidence map", async () => {
    const result = await runNode(
      "review.collectEvidence",
      {
        commentEvidenceMap: {
          schemaVersion: "CommentEvidenceMap/v1",
          fileKey: "FILE",
          mappedAt: "2026-07-01T00:00:00.000Z",
          comments: [
            {
              commentId: "comment-1",
              rootCommentId: "comment-1",
              message: "Loading state is missing",
              mappedTarget: {
                nodeId: "node-primary-action",
                nodeName: "Primary Action",
                partId: "primary-action",
                componentKey: "button-key",
              },
              mappingConfidence: "exact",
              mappingStrategy: "node-id",
              intent: "bug-usability",
              status: "actionable",
            },
            {
              commentId: "comment-2",
              rootCommentId: "comment-2",
              message: "What about the empty state?",
              mappingConfidence: "none",
              mappingStrategy: "unmapped",
              intent: "needs-human-clarification",
              status: "needs-human",
            },
          ],
          unmappedCount: 1,
        },
      },
      { source: "comments" }
    );

    expect(result.statePatch?.review).toMatchObject({
      target: { fileKey: "FILE", nodeId: "comments" },
      evidence: {
        regions: [{ nodeId: "primary-action", name: "Primary Action" }],
      },
      unmappedComments: [expect.objectContaining({ commentId: "comment-2" })],
      findings: [
        expect.objectContaining({
          nodeId: "primary-action",
          partName: "Primary Action",
          confidence: "observed",
        }),
        expect.objectContaining({
          title: "Clarify unmapped comment comment-2",
          confidence: "needs-decision",
        }),
      ],
    });
  });

  it("compares target regions to local design-system evidence", async () => {
    const result = await runNode("review.compareToDesignSystem", {
      review: reviewWithEvidence(),
      designSystem: {
        components: [
          { name: "Member table", key: "table-key" },
          { name: "Primary action", key: "button-key" },
        ],
      },
    });

    expect(result.statePatch?.screen).toMatchObject({
      title: "Member table",
      requiredUiParts: ["Member table", "Primary action", "Status chip"],
    });
    expect(result.statePatch?.fitReport).toMatchObject({
      exactMatches: [
        { requestedPart: "Member table", componentKey: "table-key" },
        { requestedPart: "Primary action", componentKey: "button-key" },
      ],
      missingComponents: [{ requestedPart: "Status chip" }],
    });
    expect(result.statePatch?.review).toMatchObject({
      target: { fileKey: "FILE", nodeId: "10:20" },
      findings: expect.arrayContaining([
        expect.objectContaining({
          theme: "component",
          severity: "high",
          nodeId: "10:23",
          title: "Create or map Status chip",
        }),
      ]),
    });
  });

  it("groups findings by theme and severity", async () => {
    const result = await runNode("review.groupFindings", {
      review: {
        ...reviewWithEvidence(),
        findings: [
          finding({ theme: "component", severity: "high" }),
          finding({ theme: "component", severity: "medium" }),
          finding({ theme: "layout", severity: "high" }),
        ],
      },
    });

    expect(result.statePatch?.review).toMatchObject({
      groupedFindings: [
        { theme: "component", severity: "high", count: 1 },
        { theme: "component", severity: "medium", count: 1 },
        { theme: "layout", severity: "high", count: 1 },
      ],
    });
  });

  it("creates a revision-plan artifact that preserves instances and variable bindings", async () => {
    const result = await runNode("review.createRevisionPlan", {
      review: {
        ...reviewWithEvidence(),
        findings: [
          finding({
            partName: "Primary action",
            componentKey: "button-key",
            nodeId: "10:22",
          }),
        ],
      },
      applyReport: {
        variableBindings: [
          { targetId: "10:22", property: "fill", source: "variable", name: "color.action" },
        ],
      },
    });

    expect(() => ArtifactSchema.parse(result.artifacts?.[0])).not.toThrow();
    expect(result.artifacts?.[0]).toMatchObject({
      type: "revision-plan",
      payload: {
        schemaVersion: "RevisionPlan/v1",
        data: {
          target: { fileKey: "FILE", nodeId: "10:20" },
          revisions: [
            {
              nodeId: "10:22",
              partName: "Primary action",
              operation: "preserve-instance-update",
              componentKey: "button-key",
              variableBindings: [
                { targetId: "10:22", property: "fill", source: "variable", name: "color.action" },
              ],
            },
          ],
        },
      },
    });
    expect(result.statePatch?.review).toMatchObject({
      revisionPlan: {
        revisions: [expect.objectContaining({ componentKey: "button-key" })],
      },
    });
  });

  it("pauses before revisions, comment posting, and memory promotion", async () => {
    await expect(
      runNode("review.askApproval", { review: { revisionPlan: { revisions: [] } } })
    ).resolves.toMatchObject({
      interrupt: {
        status: "waiting-for-user",
        pendingQuestion: {
          id: "approve-review-revisions",
          choices: ["apply-approved-revisions"],
        },
      },
    });

    await expect(
      runNode(
        "review.askApproval",
        {
          review: { revisionPlan: { revisions: [] } },
          answers: { "approve-review-revisions": "apply-approved-revisions" },
        },
        { requiresCommentApproval: true, requiresMemoryApproval: true }
      )
    ).resolves.toMatchObject({
      interrupt: {
        pendingQuestion: {
          id: "approve-comment-posting",
          choices: ["post-approved-comments", "skip-comment-posting"],
        },
      },
    });

    await expect(
      runNode(
        "review.askApproval",
        {
          review: { revisionPlan: { revisions: [] } },
          answers: {
            "approve-review-revisions": "apply-approved-revisions",
            "approve-comment-posting": "post-approved-comments",
          },
        },
        { requiresCommentApproval: true, requiresMemoryApproval: true }
      )
    ).resolves.toMatchObject({
      interrupt: {
        pendingQuestion: {
          id: "approve-memory-promotion",
          choices: ["promote-memory", "skip-memory"],
        },
      },
    });
  });

  it("can skip revision approval for comment-only review flows", async () => {
    const result = await runNode(
      "review.askApproval",
      {
        review: {
          revisionPlan: {
            revisions: [
              {
                nodeId: "10:22",
                partName: "Primary action",
                operation: "preserve-instance-update",
              },
            ],
          },
        },
      },
      { requiresRevisionApproval: false, requiresCommentApproval: true }
    );

    expect(result.interrupt).toMatchObject({
      pendingQuestion: {
        id: "approve-comment-posting",
        choices: ["post-approved-comments", "skip-comment-posting"],
      },
    });
  });

  it("applies approved revisions through safe update metadata for QA", async () => {
    const result = await runNode("review.applyApprovedRevisions", {
      figmaTarget: draftTarget(),
      answers: { "approve-review-revisions": "apply-approved-revisions" },
      review: {
        revisionPlan: {
          target: { fileKey: "FILE", nodeId: "10:20" },
          revisions: [
            {
              nodeId: "10:22",
              partName: "Primary action",
              operation: "preserve-instance-update",
              componentKey: "button-key",
              variableBindings: [
                {
                  targetId: "10:22",
                  property: "fill",
                  source: "variable",
                  name: "color.action",
                },
              ],
              layoutFrame: { id: "10:20", mode: "auto-layout", direction: "vertical" },
            },
          ],
        },
      },
    });

    expect(result.statePatch?.applyReport).toMatchObject({
      schemaVersion: "FigmaApplyReport/v1",
      status: "recorded",
      fileKey: "FILE",
      pageId: "1:2",
      nodes: [{ id: "10:22", partId: "primary-action", componentKey: "button-key" }],
      variableBindings: [
        { targetId: "10:22", property: "fill", source: "variable", name: "color.action" },
      ],
      layoutFrames: [{ id: "10:20", mode: "auto-layout", direction: "vertical" }],
    });
  });

  it("pauses for a safe draft target before applying approved revisions", async () => {
    const result = await runNode("review.applyApprovedRevisions", {
      answers: { "approve-review-revisions": "apply-approved-revisions" },
      review: {
        revisionPlan: {
          target: { fileKey: "FILE", nodeId: "10:20" },
          revisions: [
            {
              nodeId: "10:22",
              partName: "Primary action",
              operation: "preserve-instance-update",
            },
          ],
        },
      },
    });

    expect(result.interrupt).toMatchObject({
      status: "waiting-for-user",
      pendingQuestion: {
        id: "bind-review-draft-target",
        choices: ["target-bound"],
      },
    });
  });

  it("prepares approved comments after the review session is saved", async () => {
    const root = rootForDb();
    const saved = await runNode(
      "review.saveSession",
      {
        review: {
          ...reviewWithEvidence(),
          findings: [
            finding({
              nodeId: "10:22",
              partName: "Primary action",
              title: "Primary action needs alignment",
            }),
          ],
        },
        project: { root },
      },
      {}
    );
    const sessionId = String(recordFrom(saved.statePatch?.review).sessionId);
    const prepared = await runNode(
      "review.prepareApprovedComments",
      {
        review: {
          ...recordFrom(saved.statePatch?.review),
          approvals: { comments: "post-approved-comments" },
        },
        project: { root },
      },
      {}
    );

    expect(sessionId).toBeString();
    expect(prepared.statePatch?.review).toMatchObject({
      preparedComments: [expect.objectContaining({ sessionId, status: "pending" })],
    });
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>,
  params: Record<string, unknown> = {}
): Promise<NodeOutput> {
  const node = reviewNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-review",
    flowId: "improve-existing-design",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/kotikit" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}

function draftTarget(): NonNullable<KotikitGraphState["figmaTarget"]> {
  return {
    fileKey: "FILE",
    pageId: "1:2",
    pageName: "Draft - Members",
    pageUrl: "https://www.figma.com/design/FILE/Name?node-id=10-20",
    boundAt: "2026-06-30T00:00:00.000Z",
    source: "user-url",
    section: { id: "section-1", name: "kotikit / members / 2026-06-30" },
    safety: {
      requireDraftPageName: true,
      allowPageCreation: false,
      requireKotikitSection: true,
    },
  };
}

function reviewWithEvidence(): Record<string, unknown> {
  return {
    target: {
      source: "figma",
      fileKey: "FILE",
      nodeId: "10:20",
      targetKind: "frame",
      targetName: "Member table",
      figmaUrl: "https://www.figma.com/design/FILE/Name?node-id=10-20",
    },
    evidence: {
      targetSummary: { nodeId: "10:20", name: "Member table", type: "FRAME", kind: "frame" },
      tokenBudget: { maxRegions: 8, returnedRegions: 3, truncatedRegions: 0 },
      regions: [
        { nodeId: "10:21", name: "Member table", type: "INSTANCE" },
        { nodeId: "10:22", name: "Primary action", type: "INSTANCE" },
        { nodeId: "10:23", name: "Status chip", type: "FRAME" },
      ],
    },
  };
}

function finding(
  patch: Partial<{
    theme: string;
    severity: string;
    nodeId: string;
    partName: string;
    componentKey: string;
    title: string;
  }> = {}
): Record<string, unknown> {
  return {
    theme: patch.theme ?? "component",
    severity: patch.severity ?? "high",
    nodeId: patch.nodeId ?? "10:22",
    partName: patch.partName ?? "Primary action",
    componentKey: patch.componentKey,
    title: patch.title ?? "Preserve Primary action instance",
    recommendation: "Use the design-system component instance and keep token bindings.",
    suggestedComment: "Align this with the design-system pattern.",
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rootForDb(): string {
  const root = mkdtempSync(join(tmpdir(), "kotikit-review-nodes-"));
  tmpRoots.push(root);
  return root;
}
