import { describe, expect, it } from "bun:test";
import { buildServer } from "../server.js";

describe("MCP server", () => {
  it("builds without throwing", () => {
    expect(() => buildServer()).not.toThrow();
  });

  it("registry has tools array and handlers Map", () => {
    const { registry } = buildServer();
    expect(Array.isArray(registry.tools)).toBe(true);
    expect(registry.handlers).toBeInstanceOf(Map);
  });

  it("server object is constructed", () => {
    const { server } = buildServer();
    expect(server).toBeDefined();
  });

  it("registers only design-first MCP tools", () => {
    const { registry } = buildServer();
    const expectedTools = [
      "kotikit_spec_create",
      "kotikit_spec_get",
      "kotikit_spec_list",
      "kotikit_spec_update",
      "kotikit_config_status",
      "kotikit_config_init",
      "kotikit_config_get",
      "kotikit_flow_create",
      "kotikit_brainstorm_start",
      "kotikit_brainstorm_assess",
      "kotikit_brainstorm_answer",
      "kotikit_brainstorm_confirm",
      "kotikit_ds_search",
      "kotikit_ds_get_component",
      "kotikit_icons_search",
      "kotikit_sync_ds",
      "kotikit_sync_plugin_variables",
      "kotikit_component_plan_create",
      "kotikit_figma_target_bind",
      "kotikit_plan_design",
      "kotikit_design_get_screen",
      "kotikit_design_apply_step",
      "kotikit_design_review_comments",
      "kotikit_design_adjustment_record",
      "kotikit_design_review_report",
      "kotikit_design_comment_reply_prepare",
      "kotikit_design_comment_reply_post",
      "kotikit_design_memory_candidates",
      "kotikit_design_memory_promote",
      "kotikit_design_memory_dismiss",
      "kotikit_design_memory_update",
      "kotikit_design_memory_search",
      "kotikit_design_review_start",
      "kotikit_design_review_record",
      "kotikit_design_review_get",
      "kotikit_design_review_comment_prepare",
      "kotikit_design_review_comment_post",
      "kotikit_get_system_prompt",
      "kotikit_doctor",
      "kotikit_bridge_start",
      "kotikit_bridge_stop",
      "kotikit_bridge_status",
      "kotikit_workflow_start",
      "kotikit_workflow_status",
      "kotikit_workflow_next",
      "kotikit_workflow_event",
    ];
    const registeredNames = registry.tools.map((t) => t.name);
    const removedCodeTools = [
      "kotikit_plan_code",
      "kotikit_implement_code_start",
      "kotikit_implement_code_save",
      "kotikit_implement_code_gate",
      "kotikit_registry_search",
      "kotikit_scaffold_start",
      "kotikit_scaffold_save",
      "kotikit_audit",
    ];
    for (const name of expectedTools) {
      expect(registeredNames).toContain(name);
    }
    for (const name of removedCodeTools) {
      expect(registeredNames).not.toContain(name);
      expect(registry.handlers.has(name)).toBe(false);
    }
    expect(registry.tools.length).toBe(expectedTools.length);
    expect(registry.handlers.size).toBe(expectedTools.length);
  });
});
