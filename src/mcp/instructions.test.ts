import { describe, expect, it } from "bun:test";
import { KOTIKIT_MCP_INSTRUCTIONS } from "./instructions.js";

describe("KOTIKIT_MCP_INSTRUCTIONS", () => {
  it("starts with standalone workflow guidance for MCP clients", () => {
    const prefix = KOTIKIT_MCP_INSTRUCTIONS.slice(0, 512);
    expect(prefix).toContain("kotikit");
    expect(prefix).toContain("design-system-to-code");
    expect(prefix).toContain("plain language");
  });

  it("mentions prompt refs and design-system search discipline", () => {
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("kotikit_get_system_prompt");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("Search first");
    expect(KOTIKIT_MCP_INSTRUCTIONS).toContain("never load whole indexes");
  });
});
