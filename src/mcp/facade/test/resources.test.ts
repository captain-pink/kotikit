import { describe, expect, it } from "bun:test";
import { completeFacadeArgument } from "../completions.js";
import { getFacadePrompt, KOTIKIT_PROMPT_NAMES, listFacadePrompts } from "../prompts.js";
import { listFacadeResourceTemplates, readFacadeResource } from "../resources.js";

describe("MCP facade resources", () => {
  it("lists run, artifact, and flow resource templates", () => {
    const templates = listFacadeResourceTemplates();
    const uris = templates.map((template) => template.uriTemplate);

    expect(uris).toEqual([
      "kotikit://runs/{runId}",
      "kotikit://runs/{runId}/state",
      "kotikit://artifacts/{artifactId}",
      "kotikit://flows/{flowId}",
    ]);
    expect(templates.every((template) => template.mimeType === "application/json")).toBe(true);
  });

  it("reads a built-in flow resource", async () => {
    const result = await readFacadeResource("kotikit://flows/create-screen");
    const content = result.contents[0];
    const flow = JSON.parse(content !== undefined && "text" in content ? content.text : "{}") as {
      id?: string;
      nodes?: unknown[];
    };

    expect(content?.mimeType).toBe("application/json");
    expect(flow.id).toBe("create-screen");
    expect(Array.isArray(flow.nodes)).toBe(true);
  });
});

describe("MCP facade prompts", () => {
  it("lists designer-facing prompts", () => {
    const prompts = listFacadePrompts();
    const names = prompts.map((prompt) => prompt.name);

    expect(names).toEqual([...KOTIKIT_PROMPT_NAMES]);
    expect(names).toContain("kotikit.quick_screen_draft");
    expect(prompts.every((prompt) => prompt.description !== undefined)).toBe(true);
  });

  it("returns a quick screen draft prompt that uses the flow facade", () => {
    const result = getFacadePrompt("kotikit.quick_screen_draft", {
      intent: "Settings page",
    });
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";

    expect(text).toContain("Settings page");
    expect(text).toContain("kotikit_start");
    expect(text).toContain("create-screen");
  });
});

describe("MCP facade completions", () => {
  it("completes built-in flow ids", async () => {
    const result = await completeFacadeArgument({
      ref: { type: "ref/prompt", name: "kotikit.create_screen" },
      argument: { name: "flowId", value: "create" },
    });

    expect(result.completion.values).toEqual(["create-screen"]);
    expect(result.completion.total).toBe(1);
  });

  it("completes the lightweight review flow id", async () => {
    const result = await completeFacadeArgument({
      ref: { type: "ref/prompt", name: "kotikit.create_screen" },
      argument: { name: "flowId", value: "review" },
    });

    expect(result.completion.values).toEqual(["review-screen"]);
    expect(result.completion.total).toBe(1);
  });

  it("completes the refine existing flow id", async () => {
    const result = await completeFacadeArgument({
      ref: { type: "ref/prompt", name: "kotikit.create_screen" },
      argument: { name: "flowId", value: "refine" },
    });

    expect(result.completion.values).toEqual(["refine-existing"]);
    expect(result.completion.total).toBe(1);
  });
});
