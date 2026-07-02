import { describe, expect, it } from "bun:test";
import { createDesignerRecovery } from "../designer-recovery.js";

describe("designer recovery", () => {
  it("creates a plain-language recovery model", () => {
    expect(
      createDesignerRecovery({
        problem: "Kotikit could not verify the Figma Section for the active transaction.",
        why: "Writing outside the draft Section could make the generated screen hard to review.",
        recommendedAction: "Bind the exact draft page again and continue the active transaction.",
        actions: [
          { id: "bind-draft-page", label: "Bind draft page" },
          { id: "open-apply-packet", label: "Open apply packet" },
        ],
        artifactRefs: ["run-1-figma-apply-packet"],
      })
    ).toEqual({
      schemaVersion: "DesignerRecovery/v1",
      problem: "Kotikit could not verify the Figma Section for the active transaction.",
      why: "Writing outside the draft Section could make the generated screen hard to review.",
      recommendedAction: "Bind the exact draft page again and continue the active transaction.",
      actions: [
        { id: "bind-draft-page", label: "Bind draft page" },
        { id: "open-apply-packet", label: "Open apply packet" },
      ],
      artifactRefs: ["run-1-figma-apply-packet"],
    });
  });

  it("does not expose stack traces in recovery text", () => {
    const recovery = createDesignerRecovery({
      problem: "The local design-system cache is empty.",
      why: "Kotikit needs component evidence before composing a polished screen.",
      recommendedAction: "Run design-system sync or continue with draft components.",
      actions: [{ id: "kotikit_sync_ds", label: "Sync design system" }],
      technicalDetailsRef: "kotikit://runs/run-1",
    });

    expect(JSON.stringify(recovery)).not.toContain(" at ");
    expect(recovery.technicalDetailsRef).toBe("kotikit://runs/run-1");
  });
});
