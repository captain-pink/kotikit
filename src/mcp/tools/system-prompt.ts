import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { BRAINSTORM_SYSTEM_PROMPT } from "../system-prompts.js";
import { withKotikitToolSafety } from "../tool-safety.js";

type SystemPromptKind = "brainstorm";

export function registerSystemPromptTools(registry: ToolRegistry, _ctx: ToolContext): void {
  registry.tools.push(
    withKotikitToolSafety({
      name: "kotikit_get_system_prompt",
      description:
        "Fetch a long-form system prompt once per session. Brainstorm tools reference this by kind instead of inlining it.",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["brainstorm"],
            description: "Which doctrine to fetch.",
          },
        },
        required: ["kind"],
      },
    })
  );

  registry.handlers.set("kotikit_get_system_prompt", async (args) => {
    try {
      const { kind } = args as { kind?: string };
      if (kind !== "brainstorm") {
        return toolError(
          new KotikitError(
            `Unknown system prompt kind: ${kind}`,
            'Valid kinds: "brainstorm". Design-to-code prompts are not part of the kotikit core.'
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
    case "brainstorm":
      return BRAINSTORM_SYSTEM_PROMPT;
  }
}
