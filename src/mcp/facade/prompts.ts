import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";
import { KotikitError } from "../../util/result.js";

export const KOTIKIT_PROMPT_NAMES = [
  "kotikit.first_run",
  "kotikit.quick_screen_draft",
  "kotikit.create_screen",
  "kotikit.create_brief",
  "kotikit.create_figma_draft",
] as const;

type KotikitPromptName = (typeof KOTIKIT_PROMPT_NAMES)[number];

type PromptDefinition = Prompt & {
  render: (args: Record<string, string>) => string;
};

const PROMPTS: Record<KotikitPromptName, PromptDefinition> = {
  "kotikit.first_run": {
    name: "kotikit.first_run",
    title: "Kotikit First Run",
    description: "Check local setup and explain the next designer-safe setup action.",
    render: () =>
      [
        "Run kotikit_doctor first.",
        "If setup is ready, use kotikit_flow_list and recommend the smallest built-in flow that matches the designer's goal.",
        "Keep the response concise and avoid asking for technical setup details unless a tool reports a blocker.",
      ].join("\n"),
  },
  "kotikit.quick_screen_draft": {
    name: "kotikit.quick_screen_draft",
    title: "Quick Screen Draft",
    description: "Create a high-fidelity screen quickly from available design-system components.",
    arguments: [
      {
        name: "intent",
        description: "Designer request for the screen to draft.",
        required: false,
      },
    ],
    render: (args) =>
      [
        `Designer intent: ${args.intent ?? "Create a high-fidelity screen from the local design system."}`,
        "Use kotikit_start with flowId create-screen.",
        "Prefer existing design-system components, variables, and auto-layout.",
        "Compose the visible screen and its real states first; ask about draft component extraction only after the design is visible.",
      ].join("\n"),
  },
  "kotikit.create_screen": {
    name: "kotikit.create_screen",
    title: "Create Screen",
    description: "Start the built-in create-screen flow.",
    render: (args) =>
      startPrompt("create-screen", args.intent ?? "Create one polished product screen."),
  },
  "kotikit.create_brief": {
    name: "kotikit.create_brief",
    title: "Create Brief",
    description: "Capture the smallest useful product/design brief before drafting.",
    render: (args) =>
      [
        `Designer intent: ${args.intent ?? "Clarify the product/design goal."}`,
        "Use kotikit_start with flowId create-screen when the designer wants a screen.",
        "Ask only for information that blocks a correct design decision.",
      ].join("\n"),
  },
  "kotikit.create_figma_draft": {
    name: "kotikit.create_figma_draft",
    title: "Create Figma Draft",
    description: "Create a Figma draft through the built-in screen or flow draft path.",
    render: (args) =>
      [
        `Designer intent: ${args.intent ?? "Create a Figma draft."}`,
        "Use kotikit_flow_list, choose create-screen, then call kotikit_start.",
        "Read the active Figma transaction from the run result or apply-packet artifact.",
        "Apply one screen state or region state with use_figma at the canvas plan bounds.",
        "Scan the applied root node and record transactionId, node id, Figma node type, bounds, component refs or componentKey, component source, variable refs, required icon refs, autoLayout, and evidenceSnapshot with kotikit_record_figma_apply.",
        "Continue the run and repeat until no active Figma transaction remains.",
        "Compose the visible screen first; ask about draft component extraction only after the design is visible.",
        "Do not finish manually while the graph is blocked or waiting for a transaction; use the recovery action instead.",
        "Use generate_figma_design only for web or HTML capture references, not normal kotikit draft composition.",
      ].join("\n"),
  },
};

export function listFacadePrompts(): Prompt[] {
  return KOTIKIT_PROMPT_NAMES.map((name) => {
    const { render: _render, ...prompt } = PROMPTS[name];
    return prompt;
  });
}

export function getFacadePrompt(name: string, args: Record<string, string> = {}): GetPromptResult {
  if (!isKotikitPromptName(name)) {
    throw new KotikitError(
      `Unknown kotikit prompt: ${name}.`,
      "Use prompts/list to see available kotikit prompts."
    );
  }
  return {
    description: PROMPTS[name].description,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: PROMPTS[name].render(args),
        },
      },
    ],
  };
}

function isKotikitPromptName(name: string): name is KotikitPromptName {
  return (KOTIKIT_PROMPT_NAMES as readonly string[]).includes(name);
}

function startPrompt(flowId: string, intent: string): string {
  return [
    `Designer intent: ${intent}`,
    `Use kotikit_start with flowId ${flowId}.`,
    "Keep human-in-the-loop questions short and only ask when the flow reports missing decisions.",
    "Use existing components, variables, icons, and auto-layout before proposing post-design extraction.",
  ].join("\n");
}
