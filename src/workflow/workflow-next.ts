import type {
  WorkflowNextResult,
  WorkflowPhase,
  WorkflowSession,
  WorkflowSnapshot,
} from "./workflow-schema.js";

const CODE_TOOLS = [
  "kotikit_plan_code",
  "kotikit_implement_code_start",
  "kotikit_implement_code_save",
  "kotikit_scaffold_start",
  "kotikit_scaffold_save",
];

const DESIGN_PLANNING_TOOLS = ["kotikit_plan_design"];
const OFFICIAL_FIGMA_APPLY_TOOLS = ["official_figma_use", "official_figma_generate_design"];
const DESIGN_APPLY_TOOLS = [
  "kotikit_design_get_screen",
  ...OFFICIAL_FIGMA_APPLY_TOOLS,
  "kotikit_design_apply_step",
];
const DRAFT_TARGET_TOOLS = ["kotikit_figma_target_bind"];
const COMPONENT_DECISION_TOOLS = ["kotikit_component_plan_create"];
const BRIDGE_TOOLS = ["kotikit_bridge_start"];
const SYNC_TOOLS = ["kotikit_sync_ds"];
const CONFIG_TOOLS = ["kotikit_config_init"];
const VARIABLE_TOOLS = ["kotikit_bridge_start", "kotikit_sync_plugin_variables"];

const designToolBlocks = [
  ...DESIGN_PLANNING_TOOLS,
  ...DESIGN_APPLY_TOOLS,
  ...DRAFT_TARGET_TOOLS,
  ...COMPONENT_DECISION_TOOLS,
];

const refsFor = (session: WorkflowSession, snapshot: WorkflowSnapshot): Record<string, string> => ({
  ...(session.scope !== undefined ? { scope: session.scope } : {}),
  ...(session.screen !== undefined && session.screen !== null ? { screen: session.screen } : {}),
  ...(snapshot.activeTarget?.scope !== undefined ? { scope: snapshot.activeTarget.scope } : {}),
  ...(snapshot.activeTarget?.screen !== undefined && snapshot.activeTarget.screen !== null
    ? { screen: snapshot.activeTarget.screen }
    : {}),
});

const nextResult = (
  session: WorkflowSession,
  snapshot: WorkflowSnapshot,
  input: Omit<WorkflowNextResult, "workflowId" | "refs">
): WorkflowNextResult => ({
  workflowId: session.id,
  ...input,
  refs: refsFor(session, snapshot),
});

const setupResult = (session: WorkflowSession, snapshot: WorkflowSnapshot): WorkflowNextResult =>
  nextResult(session, snapshot, {
    status: "waiting-for-user",
    phase: "setup",
    nextAction: "ask-user",
    instruction:
      "Initialize kotikit for this project before syncing design systems or creating designs.",
    allowedTools: CONFIG_TOOLS,
    forbiddenTools: [...SYNC_TOOLS, ...designToolBlocks, ...CODE_TOOLS],
  });

const syncResultFor = (
  session: WorkflowSession,
  snapshot: WorkflowSnapshot
): WorkflowNextResult => {
  if (!snapshot.hasFigmaToken) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "figma-token",
      nextAction: "ask-user",
      instruction: "Ask the user to provide a Figma token before syncing the design system.",
      allowedTools: ["kotikit_config_status"],
      forbiddenTools: [...SYNC_TOOLS, ...designToolBlocks, ...CODE_TOOLS],
    });
  }

  if (!snapshot.designSystem.configured || snapshot.figmaFilesCount === 0) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "design-system-config",
      nextAction: "ask-user",
      instruction: "Ask which published Figma design-system file should be connected.",
      allowedTools: CONFIG_TOOLS,
      forbiddenTools: [...SYNC_TOOLS, ...designToolBlocks, ...CODE_TOOLS],
    });
  }

  if (!snapshot.designSystem.synced || snapshot.designSystem.hasSyncCheckpoint) {
    return nextResult(session, snapshot, {
      status: "blocked",
      phase: "design-system-sync",
      nextAction: "call-tool",
      instruction:
        "Run the design-system sync. If it pauses, call it again until the checkpoint completes.",
      allowedTools: SYNC_TOOLS,
      forbiddenTools: [...designToolBlocks, ...CODE_TOOLS],
    });
  }

  if (snapshot.designSystem.variablesSkipped && !snapshot.designSystem.hasVariables) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "variables",
      nextAction: "ask-user",
      instruction:
        "Explain that Figma API variables were unavailable and offer the plugin variable sync path.",
      allowedTools: VARIABLE_TOOLS,
      forbiddenTools: [...designToolBlocks, ...CODE_TOOLS],
    });
  }

  return nextResult(session, snapshot, {
    status: "completed",
    phase: "done",
    nextAction: "done",
    instruction: "The design system is synced and ready for design work.",
    allowedTools: [],
    forbiddenTools: CODE_TOOLS,
  });
};

const createDesignResultFor = (
  session: WorkflowSession,
  snapshot: WorkflowSnapshot
): WorkflowNextResult => {
  const designSystemNeedsAttention =
    snapshot.designSystem.hasSyncCheckpoint ||
    (snapshot.designSystem.configured &&
      (!snapshot.hasFigmaToken ||
        !snapshot.designSystem.synced ||
        (snapshot.designSystem.variablesSkipped && !snapshot.designSystem.hasVariables)));
  if (designSystemNeedsAttention) return syncResultFor(session, snapshot);

  const target = snapshot.activeTarget;
  if (target === undefined || !target.specExists) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "brainstorm",
      nextAction: "ask-user",
      instruction:
        "Clarify the intended screen and create or confirm the saved spec before planning Figma work.",
      allowedTools: ["kotikit_brainstorm_start", "kotikit_spec_create"],
      forbiddenTools: [...DESIGN_PLANNING_TOOLS, ...DESIGN_APPLY_TOOLS, ...CODE_TOOLS],
    });
  }

  if (!target.hasDraftTarget) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "draft-target",
      nextAction: "ask-user",
      instruction:
        "Ask the user for the exact Figma draft page or section, then bind it before planning design edits.",
      allowedTools: DRAFT_TARGET_TOOLS,
      forbiddenTools: [...DESIGN_PLANNING_TOOLS, ...DESIGN_APPLY_TOOLS, ...CODE_TOOLS],
    });
  }

  if (target.unresolvedComponents.length > 0) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "component-decisions",
      nextAction: "ask-user",
      instruction:
        "Ask whether missing components should become reusable draft components or inline design-only elements.",
      allowedTools: COMPONENT_DECISION_TOOLS,
      forbiddenTools: [...DESIGN_APPLY_TOOLS, ...CODE_TOOLS],
    });
  }

  if (
    target.componentCreationRequired.length > 0 &&
    session.approvals.reusableComponentsReviewed !== true
  ) {
    return nextResult(session, snapshot, {
      status: "waiting-for-user",
      phase: "component-review",
      nextAction: "ask-user",
      instruction:
        "Pause for human review of newly created reusable components before continuing the screen.",
      allowedTools: COMPONENT_DECISION_TOOLS,
      forbiddenTools: [...DESIGN_APPLY_TOOLS, ...CODE_TOOLS],
    });
  }

  if (!target.hasDesignPlan) {
    return nextResult(session, snapshot, {
      status: "blocked",
      phase: "design-plan",
      nextAction: "call-tool",
      instruction: "Create the Figma execution plan from the confirmed spec and draft target.",
      allowedTools: DESIGN_PLANNING_TOOLS,
      forbiddenTools: [...DESIGN_APPLY_TOOLS, ...CODE_TOOLS],
    });
  }

  if (target.applyProgress.complete) {
    return nextResult(session, snapshot, {
      status: "completed",
      phase: "done",
      nextAction: "done",
      instruction: "The design plan has been applied.",
      allowedTools: [],
      forbiddenTools: CODE_TOOLS,
    });
  }

  return nextResult(session, snapshot, {
    status: "blocked",
    phase: "official-figma-apply",
    nextAction: "call-tool",
    instruction:
      "Fetch the kotikit apply packet, use the official Figma MCP integration to create or refine the design, then record applied node metadata in kotikit.",
    allowedTools: DESIGN_APPLY_TOOLS,
    forbiddenTools: [...BRIDGE_TOOLS, ...CODE_TOOLS],
  });
};

const reviewResultFor = (
  session: WorkflowSession,
  snapshot: WorkflowSnapshot,
  phase: WorkflowPhase
): WorkflowNextResult =>
  nextResult(session, snapshot, {
    status: "blocked",
    phase,
    nextAction: "call-tool",
    instruction:
      phase === "review-comments"
        ? "Read Figma comments through the REST API and map them with kotikit node metadata."
        : "Run the focused Figma review tool and keep evidence bounded to the requested target.",
    allowedTools:
      phase === "review-comments"
        ? ["kotikit_design_review_comments"]
        : ["kotikit_design_review_start", "kotikit_design_review_record"],
    forbiddenTools: CODE_TOOLS,
  });

export function decideWorkflowNext(
  input: Readonly<{
    session: WorkflowSession;
    snapshot: WorkflowSnapshot;
  }>
): WorkflowNextResult {
  const { session, snapshot } = input;
  if (!snapshot.initialized) return setupResult(session, snapshot);
  if (session.intent === "sync-design-system") return syncResultFor(session, snapshot);
  if (session.intent === "create-design") return createDesignResultFor(session, snapshot);
  if (session.intent === "review-comments") {
    return reviewResultFor(session, snapshot, "review-comments");
  }
  if (session.intent === "design-review") {
    return reviewResultFor(session, snapshot, "design-quality-review");
  }
  return nextResult(session, snapshot, {
    status: "waiting-for-user",
    phase: "brainstorm",
    nextAction: "ask-user",
    instruction: "Clarify the user's intent and save the next spec decision.",
    allowedTools: ["kotikit_brainstorm_start", "kotikit_spec_create"],
    forbiddenTools: CODE_TOOLS,
  });
}
