import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  buildDraftComponentLifecycle,
  verifyDraftComponentLifecycle,
} from "../draft-component-lifecycle.js";

describe("draft component lifecycle", () => {
  it("marks created draft components as used when instances exist", () => {
    const lifecycle = buildDraftComponentLifecycle({
      plan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-table-row", name: "Table row", reason: "Missing" }],
      },
      createdDraftComponents: [
        { id: "draft-table-row", name: "Table row", componentKey: "component-key", nodeId: "1:2" },
      ],
      appliedInstances: [{ draftComponentId: "draft-table-row", nodeId: "2:1" }],
    });

    expect(lifecycle.components).toEqual([
      expect.objectContaining({
        draftComponentId: "draft-table-row",
        status: "used",
        requiredInstances: 1,
      }),
    ]);
  });

  it("blocks orphan draft components", () => {
    const lifecycle = buildDraftComponentLifecycle({
      plan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-table-row", name: "Table row", reason: "Missing" }],
      },
      createdDraftComponents: [
        { id: "draft-table-row", name: "Table row", componentKey: "component-key", nodeId: "1:2" },
      ],
      appliedInstances: [],
    });

    expect(() => verifyDraftComponentLifecycle(lifecycle)).toThrow(KotikitError);
  });
});
