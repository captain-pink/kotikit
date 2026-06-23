import { REACT_SYSTEM_PROMPT } from "../../codegen/react/system-prompt.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { BRAINSTORM_SYSTEM_PROMPT } from "./brainstorm.js";

type SystemPromptKind = "react" | "brainstorm" | "scaffold";

export function registerSystemPromptTools(registry: ToolRegistry, _ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_get_system_prompt",
    description:
      "Fetch a long-form system prompt once per session — the implement_code, scaffold, and brainstorm tools reference these by kind instead of inlining them.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["react", "brainstorm", "scaffold"],
          description: "Which doctrine to fetch.",
        },
      },
      required: ["kind"],
    },
  });

  registry.handlers.set("kotikit_get_system_prompt", async (args) => {
    try {
      const { kind } = args as { kind?: string };
      if (kind !== "react" && kind !== "brainstorm" && kind !== "scaffold") {
        return toolError(
          new KotikitError(
            `Unknown system prompt kind: ${kind}`,
            'Valid kinds: "react", "brainstorm", "scaffold".'
          )
        );
      }
      const prompt = promptFor(kind as SystemPromptKind);
      return toolText(`System prompt for ${kind} (v1).`, { prompt, kind, version: "1" });
    } catch (err) {
      return toolError(err);
    }
  });
}

function promptFor(kind: SystemPromptKind): string {
  switch (kind) {
    case "react":
      return REACT_SYSTEM_PROMPT;
    case "scaffold":
      return REACT_SYSTEM_PROMPT; // scaffold uses the same React doctrine
    case "brainstorm":
      return BRAINSTORM_SYSTEM_PROMPT;
  }
}
