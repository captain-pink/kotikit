import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KotikitError } from "../../../util/result.js";
import { createArtifactStore } from "../artifact-store.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-artifact-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createArtifactStore", () => {
  it("writes, reads, and lists artifacts", async () => {
    const store = createArtifactStore(root);
    const artifact = {
      id: "artifact-1",
      runId: "run-1",
      type: "ui-composition-contract" as const,
      schemaVersion: "UICompositionContract/v1",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      sourceNode: { key: "fixture.finish", version: "1.0.0" },
      payload: {
        schemaVersion: "UICompositionContract/v1" as const,
        parts: [
          {
            id: "primary-action",
            name: "Primary action",
            role: "button",
            source: "existing-component" as const,
            componentKey: "button-key",
          },
        ],
      },
    };

    await store.writeArtifact(artifact);

    await expect(store.getArtifact("artifact-1")).resolves.toEqual(artifact);
    await expect(store.listArtifacts("run-1")).resolves.toEqual([artifact]);
  });

  it("rejects artifact ids that could escape the artifact directory", async () => {
    const store = createArtifactStore(root);

    await expect(
      store.writeArtifact({
        id: "../../escape",
        runId: "run-1",
        type: "ui-composition-contract",
        schemaVersion: "UICompositionContract/v1",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
        sourceNode: { key: "fixture.finish", version: "1.0.0" },
        payload: {
          schemaVersion: "UICompositionContract/v1",
          parts: [
            {
              id: "primary-action",
              name: "Primary action",
              role: "button",
              source: "existing-component",
              componentKey: "button-key",
            },
          ],
        },
      })
    ).rejects.toThrow(KotikitError);
    await expect(store.getArtifact("../../escape")).rejects.toThrow(KotikitError);
  });

  it("rejects artifact envelopes that do not match their payload schema", async () => {
    const store = createArtifactStore(root);

    await expect(
      store.writeArtifact({
        id: "artifact-1",
        runId: "run-1",
        type: "ui-composition-contract",
        schemaVersion: "UICompositionContract/v1",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
        sourceNode: { key: "fixture.finish", version: "1.0.0" },
        payload: {
          schemaVersion: "LayoutContract/v1",
          strategy: "auto-layout",
          frames: [],
        },
      })
    ).rejects.toThrow(KotikitError);
  });
});
