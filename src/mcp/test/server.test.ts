import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFacadeResource } from "../facade/resources.js";
import { FACADE_TOOL_NAMES } from "../facade/tools.js";
import { buildServer } from "../server.js";

const tmpDirs: string[] = [];
const safeAutoApprovedTools = [
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
];
const unsafePromptedTools = [
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
  "kotikit_record_figma_apply",
  "kotikit_review_figma_target",
];

afterAll(() => {
  tmpDirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

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

  it("wires facade resources to the server graph runtime", async () => {
    const root = mkProject();
    const { runtime } = buildServer({ root });
    const started = await runtime.startFlow({
      flowId: "create-screen",
      input: {
        project: { root },
        userIntent: "Create a members table screen.",
      },
    });

    const result = await readFacadeResource(`kotikit://runs/${started.runId}`, { runtime });
    const content = result.contents[0];
    const run = JSON.parse(content !== undefined && "text" in content ? content.text : "{}") as {
      runId?: string;
      status?: string;
    };

    expect(run.runId).toBe(started.runId);
    expect(run.status).toBe("waiting-for-user");
  });

  it("registers facade tools plus support tools without old choreography tools", () => {
    const { registry } = buildServer();
    const supportTools = [
      "kotikit_config_status",
      "kotikit_config_init",
      "kotikit_config_get",
      "kotikit_ds_search",
      "kotikit_ds_get_component",
      "kotikit_icons_search",
      "kotikit_sync_ds",
      "kotikit_sync_plugin_variables",
      "kotikit_get_system_prompt",
      "kotikit_bridge_start",
      "kotikit_bridge_stop",
      "kotikit_bridge_status",
    ];
    const expectedTools = [...FACADE_TOOL_NAMES, ...supportTools];
    const registeredNames = registry.tools.map((t) => t.name);
    const removedTools = [
      "kotikit_plan_code",
      "kotikit_implement_code_start",
      "kotikit_implement_code_save",
      "kotikit_implement_code_gate",
      "kotikit_registry_search",
      "kotikit_scaffold_start",
      "kotikit_scaffold_save",
      "kotikit_audit",
      "kotikit_workflow_start",
      "kotikit_workflow_status",
      "kotikit_workflow_next",
      "kotikit_workflow_event",
      "kotikit_brainstorm_start",
      "kotikit_brainstorm_assess",
      "kotikit_brainstorm_answer",
      "kotikit_brainstorm_confirm",
      "kotikit_spec_create",
      "kotikit_spec_get",
      "kotikit_spec_list",
      "kotikit_spec_update",
      "kotikit_flow_create",
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
    ];
    for (const name of expectedTools) {
      expect(registeredNames).toContain(name);
    }
    for (const name of removedTools) {
      expect(registeredNames).not.toContain(name);
      expect(registry.handlers.has(name)).toBe(false);
    }
    expect(registeredNames.slice(0, FACADE_TOOL_NAMES.length)).toEqual([...FACADE_TOOL_NAMES]);
    expect(registeredNames.filter((name) => name === "kotikit_doctor")).toHaveLength(1);
    expect(registry.tools.length).toBe(expectedTools.length);
    expect(registry.handlers.size).toBe(expectedTools.length);
  });

  it("classifies every tool with conservative MCP safety annotations", () => {
    const { registry } = buildServer();
    const toolsByName = new Map(registry.tools.map((tool) => [tool.name, tool]));

    for (const tool of registry.tools) {
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations?.idempotentHint).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint).toBe("boolean");
    }

    for (const toolName of safeAutoApprovedTools) {
      const tool = toolsByName.get(toolName);
      expect(tool?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    for (const toolName of unsafePromptedTools) {
      const tool = toolsByName.get(toolName);
      expect(tool?.annotations?.readOnlyHint).not.toBe(true);
    }
  });
});

function mkProject(): string {
  const root = mkdtempSync(join(tmpdir(), "kotikit-server-"));
  tmpDirs.push(root);
  return root;
}
