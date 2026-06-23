import { describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerSystemPromptTools } from "./system-prompt.js";

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}
function makeCtx(): ToolContext {
  return { root: "/tmp/x", loadConfig: async () => null };
}
async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error("missing handler " + name);
  return handler(args);
}
function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
}

describe("kotikit_get_system_prompt", () => {
  it("kind=react returns the React doctrine with the quality bar sentence", async () => {
    const registry = makeRegistry();
    registerSystemPromptTools(registry, makeCtx());
    const result = await callTool(registry, "kotikit_get_system_prompt", { kind: "react" });
    expect(result.isError).toBeFalsy();
    const detail = parseDetail(result.content[0]!.text) as { prompt: string; kind: string };
    expect(detail.kind).toBe("react");
    expect(detail.prompt.toLowerCase()).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
    expect(detail.prompt).toContain("TypeScript strict");
  });

  it("kind=brainstorm returns the brainstorm doctrine", async () => {
    const registry = makeRegistry();
    registerSystemPromptTools(registry, makeCtx());
    const result = await callTool(registry, "kotikit_get_system_prompt", { kind: "brainstorm" });
    const detail = parseDetail(result.content[0]!.text) as { prompt: string; kind: string };
    expect(detail.kind).toBe("brainstorm");
    expect(detail.prompt.toLowerCase()).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
  });

  it("kind=scaffold returns the React doctrine (shared with implement_code)", async () => {
    const registry = makeRegistry();
    registerSystemPromptTools(registry, makeCtx());
    const result = await callTool(registry, "kotikit_get_system_prompt", { kind: "scaffold" });
    const detail = parseDetail(result.content[0]!.text) as { prompt: string; kind: string };
    expect(detail.kind).toBe("scaffold");
    expect(detail.prompt).toContain("TypeScript strict");
  });

  it("unknown kind returns a friendly error", async () => {
    const registry = makeRegistry();
    registerSystemPromptTools(registry, makeCtx());
    const result = await callTool(registry, "kotikit_get_system_prompt", { kind: "unknown" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown system prompt kind");
  });

  it("response includes version: '1'", async () => {
    const registry = makeRegistry();
    registerSystemPromptTools(registry, makeCtx());
    const result = await callTool(registry, "kotikit_get_system_prompt", { kind: "react" });
    const detail = parseDetail(result.content[0]!.text) as { version: string };
    expect(detail.version).toBe("1");
  });
});
