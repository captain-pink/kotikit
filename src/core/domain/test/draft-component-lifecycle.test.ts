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
        {
          id: "draft-table-row",
          name: "Table row",
          componentKey: "component-key",
          componentNodeId: "1:2",
        },
      ],
      appliedInstances: [{ draftComponentId: "draft-table-row", nodeId: "2:1" }],
    });

    expect(lifecycle.components).toEqual([
      expect.objectContaining({
        draftComponentId: "draft-table-row",
        componentNodeId: "1:2",
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

  it("blocks draft components that overlap the generated screen", () => {
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
      placements: [
        {
          draftComponentId: "draft-table-row",
          sectionName: "Kotikit Draft Components",
          overlapsGeneratedScreen: true,
        },
      ],
    });

    expect(lifecycle.components[0]).toMatchObject({
      draftComponentId: "draft-table-row",
      status: "overlap-blocked",
    });
    expect(() => verifyDraftComponentLifecycle(lifecycle)).toThrow("overlaps");
  });
});
