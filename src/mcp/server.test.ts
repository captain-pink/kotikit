import { describe, it, expect } from "bun:test";
import { buildServer } from "./server.js";

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

  it("registers all Phase 1-6 tools", () => {
    const { registry } = buildServer();
    const expectedTools = [
      // Phase 1
      "kotikit_spec_create", "kotikit_spec_get", "kotikit_spec_list", "kotikit_spec_update",
      "kotikit_config_status", "kotikit_config_init", "kotikit_config_get",
      "kotikit_flow_create",
      "kotikit_brainstorm_start", "kotikit_brainstorm_assess",
      // Phase 2
      "kotikit_ds_search", "kotikit_ds_get_component",
      "kotikit_icons_search",
      "kotikit_sync_ds",
      // Phase 3
      "kotikit_plan_code",
      "kotikit_implement_code_start", "kotikit_implement_code_save", "kotikit_implement_code_gate",
      "kotikit_registry_search",
      // Phase 4
      "kotikit_scaffold_start", "kotikit_scaffold_save",
      // Phase 5
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
      "kotikit_design_memory_search",
      // Phase 6
      "kotikit_audit",
      "kotikit_get_system_prompt",
    ];
    const registeredNames = registry.tools.map((t) => t.name);
    for (const name of expectedTools) {
      expect(registeredNames).toContain(name);
    }
    expect(registry.tools.length).toBe(expectedTools.length);
    expect(registry.handlers.size).toBe(expectedTools.length);
  });
});
