import type { Tool } from "@modelcontextprotocol/sdk/types.js";

type ToolAnnotations = NonNullable<Tool["annotations"]>;

export const KOTIKIT_AUTO_APPROVED_TOOL_NAMES = [
  "kotikit_flow_list",
  "kotikit_flow_validate",
  "kotikit_get_artifact",
  "kotikit_list_artifacts",
  "kotikit_search_design_system",
  "kotikit_ds_search",
  "kotikit_ds_get_component",
  "kotikit_icons_search",
  "kotikit_get_system_prompt",
  "kotikit_config_status",
] as const;

const KOTIKIT_TOOL_NAMES = [
  ...KOTIKIT_AUTO_APPROVED_TOOL_NAMES,
  "kotikit_doctor",
  "kotikit_config_get",
  "kotikit_config_init",
  "kotikit_sync_ds",
  "kotikit_sync_plugin_variables",
  "kotikit_bridge_start",
  "kotikit_bridge_stop",
  "kotikit_bridge_status",
  "kotikit_start",
  "kotikit_continue",
  "kotikit_answer",
  "kotikit_bind_figma_target",
  "kotikit_feedback_snapshot",
  "kotikit_record_figma_apply",
] as const;

type KotikitToolName = (typeof KOTIKIT_TOOL_NAMES)[number];

interface ToolSafety {
  autoApprove: boolean;
  annotations: ToolAnnotations;
}

const localReadAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const localStateAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const remoteOrSecretAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const KOTIKIT_TOOL_SAFETY = Object.fromEntries(
  KOTIKIT_TOOL_NAMES.map((name) => {
    const autoApprove = KOTIKIT_AUTO_APPROVED_TOOL_NAMES.includes(
      name as (typeof KOTIKIT_AUTO_APPROVED_TOOL_NAMES)[number]
    );
    const remoteOrSecret =
      name === "kotikit_doctor" ||
      name === "kotikit_config_get" ||
      name === "kotikit_sync_ds" ||
      name === "kotikit_feedback_snapshot";
    return [
      name,
      {
        autoApprove,
        annotations: autoApprove
          ? localReadAnnotations
          : remoteOrSecret
            ? remoteOrSecretAnnotations
            : localStateAnnotations,
      },
    ];
  })
) as Record<KotikitToolName, ToolSafety>;

export function withKotikitToolSafety<TTool extends Tool>(tool: TTool): TTool {
  const safety = KOTIKIT_TOOL_SAFETY[tool.name as KotikitToolName];
  if (safety === undefined) {
    throw new Error(`Kotikit tool is missing a safety classification: ${tool.name}`);
  }
  return {
    ...tool,
    annotations: {
      ...tool.annotations,
      ...safety.annotations,
    },
  };
}
