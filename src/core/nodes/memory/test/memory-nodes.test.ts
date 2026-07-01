import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDesignReviewDb } from "../../../../db/design-review-db.js";
import { ArtifactSchema } from "../../../schemas/artifact.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { memoryNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status: "waiting-for-user";
    pendingQuestion: NonNullable<KotikitGraphState["pendingQuestion"]>;
  };
  artifacts?: unknown[];
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-memory-nodes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("memory graph nodes", () => {
  it("detects a preference candidate from approved review adjustments and saves an artifact", async () => {
    const result = await runNode("memory.detectPreferenceCandidate", {
      review: {
        approvals: { memory: "promote-memory" },
        revisionPlan: {
          sessionId: "session-1",
          target: { fileKey: "FILE", nodeId: "10:20" },
          revisions: [
            {
              nodeId: "10:22",
              partName: "Primary action",
              theme: "component",
              recommendation: "Prefer compact primary actions in table toolbars.",
            },
          ],
        },
      },
    });

    expect(() => ArtifactSchema.parse(result.artifacts?.[0])).not.toThrow();
    expect(result.statePatch?.review).toMatchObject({
      memoryCandidate: {
        key: "component.compact_primary_actions_table_toolbars",
        rule: "Prefer compact primary actions in table toolbars.",
        status: "candidate",
      },
    });

    const candidates = openDesignReviewDb(root).listPreferenceCandidates();
    expect(candidates).toEqual([
      expect.objectContaining({
        key: "component.compact_primary_actions_table_toolbars",
        status: "candidate",
      }),
    ]);
  });

  it("selects the current review candidate over older higher-evidence candidates", async () => {
    const db = openDesignReviewDb(root);
    db.recordDesignAdjustment({
      category: "density",
      summary: "Use compact rows for admin tables.",
      preferenceKey: "tables.density.compact_rows",
    });
    db.recordDesignAdjustment({
      category: "density",
      summary: "Use compact rows for admin tables.",
      preferenceKey: "tables.density.compact_rows",
      scope: "teams",
    });

    const result = await runNode("memory.detectPreferenceCandidate", {
      review: {
        revisionPlan: {
          target: { fileKey: "FILE", nodeId: "10:20" },
          revisions: [
            {
              nodeId: "10:22",
              partName: "Primary action",
              theme: "component",
              recommendation: "Prefer compact primary actions in table toolbars.",
            },
          ],
        },
      },
    });

    expect(result.statePatch?.review).toMatchObject({
      memoryCandidate: {
        key: "component.compact_primary_actions_table_toolbars",
      },
    });
  });

  it("pauses memory promotion for explicit approval", async () => {
    const result = await runNode("memory.askPromotionApproval", {
      review: { memoryCandidate: { key: "component.actions", rule: "Use compact actions." } },
    });

    expect(result.interrupt).toMatchObject({
      status: "waiting-for-user",
      pendingQuestion: {
        id: "approve-memory-promotion",
        prompt: expect.stringContaining("Promote"),
        choices: ["promote-memory", "skip-memory"],
      },
    });
  });

  it("promotes approved candidates through the existing design-review database", async () => {
    openDesignReviewDb(root).recordDesignAdjustment({
      category: "component",
      scope: "admin",
      screen: "members",
      summary: "Prefer compact primary actions in table toolbars.",
    });

    const result = await runNode("memory.promotePreference", {
      answers: { "approve-memory-promotion": "promote-memory" },
      review: {
        memoryCandidate: {
          key: "component.compact_primary_actions_table_toolbars",
          scope: "admin",
        },
      },
    });

    expect(result.statePatch?.review).toMatchObject({
      promotedMemory: {
        key: "component.compact_primary_actions_table_toolbars",
        status: "active",
        scope: "admin",
      },
    });
    expect(openDesignReviewDb(root).searchDesignPreferences({ scope: "admin" })).toEqual([
      expect.objectContaining({
        key: "component.compact_primary_actions_table_toolbars",
        status: "active",
      }),
    ]);
  });
});

async function runNode(key: string, patch: Partial<KotikitGraphState>): Promise<NodeOutput> {
  const node = memoryNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput;
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-memory",
    flowId: "review-comments",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
