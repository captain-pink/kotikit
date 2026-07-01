import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "../../../../e2e/graph/fixtures/fake-figma.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-context-durability-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("context durability", () => {
  it("resumes create-screen from persisted state after a process-style runtime restart", async () => {
    seedLocalDesignSystem(root, { includePrimaryAction: false });
    const first = await createGraphSmokeFixture(root);
    const started = await first.runtime.startFlow({
      flowId: "create-screen",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent: "Create Admin members page",
        figmaTarget: fakeDraftTarget("Draft - Members"),
      },
    });

    expect(started.status).toBe("waiting-for-user");

    const second = await createGraphSmokeFixture(root);
    const resumed = await second.runtime.answerRun({
      runId: started.runId,
      answer: "create-draft-components",
    });

    expect(resumed.runId).toBe(started.runId);
    expect(resumed.state.runId).toBe(started.runId);
    expect(JSON.stringify(resumed.state).length).toBeLessThan(256 * 1024);
  });

  it("blocks oversized initial graph state before running nodes", async () => {
    seedLocalDesignSystem(root, { includePrimaryAction: false });
    const { runtime } = await createGraphSmokeFixture(root);

    await expect(
      runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Smoke Project" },
          userIntent: "Create Admin members page",
          figmaTarget: fakeDraftTarget("Draft - Members"),
          review: { rawPayload: "x".repeat(300_000) },
        },
      })
    ).rejects.toThrow("too much context");
  });
});
