import { describe, expect, it } from "bun:test";
import { createDesignerRecovery } from "../designer-recovery.js";

describe("designer recovery", () => {
  it("creates a plain-language recovery model", () => {
    expect(
      createDesignerRecovery({
        problem: "Kotikit cannot map 2 comments to exact layers.",
        why: "Guessing targets could apply revisions to the wrong part of the design.",
        recommendedAction: "Treat them as page-level feedback or open the comment map artifact.",
        actions: [
          { id: "page-feedback", label: "Use page-level feedback" },
          { id: "open-artifact", label: "Open comment map" },
        ],
        artifactRefs: ["run-1-comment-evidence-map"],
      })
    ).toEqual({
      schemaVersion: "DesignerRecovery/v1",
      problem: "Kotikit cannot map 2 comments to exact layers.",
      why: "Guessing targets could apply revisions to the wrong part of the design.",
      recommendedAction: "Treat them as page-level feedback or open the comment map artifact.",
      actions: [
        { id: "page-feedback", label: "Use page-level feedback" },
        { id: "open-artifact", label: "Open comment map" },
      ],
      artifactRefs: ["run-1-comment-evidence-map"],
    });
  });

  it("does not expose stack traces in recovery text", () => {
    const recovery = createDesignerRecovery({
      problem: "The local design-system cache is empty.",
      why: "Kotikit needs component evidence before composing a polished screen.",
      recommendedAction: "Run design-system sync or continue with draft components.",
      actions: [{ id: "sync-design-system", label: "Sync design system" }],
      technicalDetailsRef: "kotikit://runs/run-1",
    });

    expect(JSON.stringify(recovery)).not.toContain(" at ");
    expect(recovery.technicalDetailsRef).toBe("kotikit://runs/run-1");
  });
});
