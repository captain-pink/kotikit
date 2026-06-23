import { describe, expect, it } from "bun:test";
import { decideWorkflowNext } from "../workflow-next";
import type { WorkflowSession, WorkflowSnapshot } from "../workflow-schema";

const session = (input: Partial<WorkflowSession> = {}): WorkflowSession => ({
  schemaVersion: 1,
  id: "workflow-1",
  intent: "create-design",
  status: "active",
  currentPhase: "setup",
  completedMilestones: [],
  approvals: {},
  createdAt: "2026-06-23T10:00:00.000Z",
  updatedAt: "2026-06-23T10:00:00.000Z",
  ...input,
});

const snapshot = (input: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot => ({
  initialized: true,
  isGitRepo: true,
  hasFigmaToken: true,
  figmaFilesCount: 1,
  designSystem: {
    configured: true,
    synced: true,
    hasVariables: true,
    variablesSkipped: false,
    hasSyncCheckpoint: false,
  },
  bridge: {
    running: true,
    staleConfig: false,
  },
  activeTarget: {
    scope: "members",
    screen: null,
    specExists: true,
    flowExists: false,
    hasDraftTarget: true,
    hasDesignPlan: true,
    unresolvedComponents: [],
    componentCreationRequired: [],
    inlineDraftRequired: [],
    applyProgress: { applied: 0, total: 0, complete: false },
  },
  ...input,
});

describe("decideWorkflowNext", () => {
  it("asks for setup before any other workflow phase", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "sync-design-system" }),
      snapshot: snapshot({ initialized: false }),
    });

    expect(result.phase).toBe("setup");
    expect(result.status).toBe("waiting-for-user");
    expect(result.nextAction).toBe("ask-user");
    expect(result.allowedTools).toEqual(["kotikit_config_init"]);
    expect(result.forbiddenTools).toContain("kotikit_sync_ds");
    expect(JSON.stringify(result)).not.toContain("history");
  });

  it("routes configured unsynced design systems to sync_ds", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "sync-design-system" }),
      snapshot: snapshot({
        designSystem: {
          configured: true,
          synced: false,
          hasVariables: false,
          variablesSkipped: false,
          hasSyncCheckpoint: false,
        },
      }),
    });

    expect(result.phase).toBe("design-system-sync");
    expect(result.nextAction).toBe("call-tool");
    expect(result.allowedTools).toEqual(["kotikit_sync_ds"]);
  });

  it("requires a draft page target before design planning", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "create-design", scope: "members" }),
      snapshot: snapshot({
        activeTarget: {
          scope: "members",
          screen: null,
          specExists: true,
          flowExists: false,
          hasDraftTarget: false,
          hasDesignPlan: false,
          unresolvedComponents: [],
          componentCreationRequired: [],
          inlineDraftRequired: [],
          applyProgress: { applied: 0, total: 0, complete: false },
        },
      }),
    });

    expect(result.phase).toBe("draft-target");
    expect(result.status).toBe("waiting-for-user");
    expect(result.nextAction).toBe("ask-user");
    expect(result.allowedTools).toEqual(["kotikit_figma_target_bind"]);
    expect(result.forbiddenTools).toContain("kotikit_plan_design");
    expect(result.forbiddenTools).toContain("kotikit_design_get_screen");
  });

  it("syncs a configured design system before creating a Figma design", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "create-design", scope: "members" }),
      snapshot: snapshot({
        designSystem: {
          configured: true,
          synced: false,
          hasVariables: false,
          variablesSkipped: false,
          hasSyncCheckpoint: false,
        },
      }),
    });

    expect(result.phase).toBe("design-system-sync");
    expect(result.nextAction).toBe("call-tool");
    expect(result.allowedTools).toEqual(["kotikit_sync_ds"]);
    expect(result.forbiddenTools).toContain("kotikit_plan_design");
  });

  it("blocks design apply until unresolved components have a user decision", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "create-design", scope: "members" }),
      snapshot: snapshot({
        activeTarget: {
          scope: "members",
          screen: null,
          specExists: true,
          flowExists: false,
          hasDraftTarget: true,
          hasDesignPlan: true,
          unresolvedComponents: ["Status Toggle"],
          componentCreationRequired: [],
          inlineDraftRequired: [],
          applyProgress: { applied: 0, total: 12, complete: false },
        },
      }),
    });

    expect(result.phase).toBe("component-decisions");
    expect(result.status).toBe("waiting-for-user");
    expect(result.allowedTools).toEqual(["kotikit_component_plan_create"]);
    expect(result.forbiddenTools).toContain("kotikit_design_apply_step");
  });

  it("starts the bridge only after design prerequisites are ready", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "create-design", scope: "members" }),
      snapshot: snapshot({
        bridge: { running: false, staleConfig: false },
      }),
    });

    expect(result.phase).toBe("bridge");
    expect(result.nextAction).toBe("call-tool");
    expect(result.allowedTools).toEqual(["kotikit_bridge_start"]);
  });

  it("reports a compact ready-to-apply action when design context is ready", () => {
    const result = decideWorkflowNext({
      session: session({ intent: "create-design", scope: "members" }),
      snapshot: snapshot(),
    });

    expect(result.phase).toBe("plugin-apply");
    expect(result.nextAction).toBe("call-tool");
    expect(result.allowedTools).toEqual(["kotikit_design_get_screen", "kotikit_design_apply_step"]);
    expect(result.refs).toEqual({ scope: "members" });
  });
});
