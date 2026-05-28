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

  it("registers all Phase 1 and Phase 2 tools", () => {
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
    ];
    const registeredNames = registry.tools.map((t) => t.name);
    for (const name of expectedTools) {
      expect(registeredNames).toContain(name);
    }
    expect(registry.tools.length).toBe(expectedTools.length);
    expect(registry.handlers.size).toBe(expectedTools.length);
  });
});
