import { describe, expect, it } from "bun:test";
import { KOTIKIT_MCP_INSTRUCTIONS } from "../instructions.js";

describe("KOTIKIT_MCP_INSTRUCTIONS", () => {
  it("starts with standalone workflow guidance for MCP clients", () => {
    const prefix = KOTIKIT_MCP_INSTRUCTIONS.slice(0, 512);
    expect(prefix).toContain("kotikit");
    expect(prefix).toContain("design-first");
    expect(prefix).toContain("plain language");
  });

  it("tells agents that code generation is not part of the core workflow", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("Do not generate code");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("Design-to-code is not part of the kotikit core");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain(
      "For code generation, use kotikit_implement_code_start"
    );
  });

  it("mentions prompt refs and design-system search discipline", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_get_system_prompt");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("Search first");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("never load whole indexes");
  });

  it("keeps guided work on graph flows instead of removed choreography tools", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_start");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_answer");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("real designer input");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain("kotikit_workflow_");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain("kotikit_brainstorm_");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain("kotikit_spec_");
  });

  it("tells agents to ask before planning missing components", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("missing-component strategy");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("explicit designer approval");
  });

  it("requires a bound draft page before Figma design application", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_bind_figma_target");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("page name must contain Draft or Drafts");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit-owned Section");
  });

  it("uses official Figma MCP for design application and reserves kotikit plugin for variables", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("official Figma MCP");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("use_figma");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("generate_figma_design");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_get_artifact");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_record_figma_apply");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("figmaNodeKind as COMPONENT");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("real Figma component key");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("Do not finish Figma work manually");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("local kotikit plugin only for variable export");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain("then call kotikit_design_apply_step");
    expect(KOTIKIT_MCP_INSTRUCTIONS).not.toContain("Start the Figma plugin bridge before applying");
  });
});
