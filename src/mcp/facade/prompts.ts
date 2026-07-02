import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";
import { KotikitError } from "../../util/result.js";

export const KOTIKIT_PROMPT_NAMES = [
  "kotikit.first_run",
  "kotikit.quick_screen_draft",
  "kotikit.create_screen",
  "kotikit.create_product_flow",
  "kotikit.improve_existing_design",
  "kotikit.review_comments",
  "kotikit.create_brief",
  "kotikit.create_figma_draft",
  "kotikit.review_figma_design",
  "kotikit.sync_design_system",
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
        "If a needed component is missing, create it on the current draft page before composing the screen.",
      ].join("\n"),
  },
  "kotikit.create_screen": {
    name: "kotikit.create_screen",
    title: "Create Screen",
    description: "Start the built-in create-screen flow.",
    render: (args) =>
      startPrompt("create-screen", args.intent ?? "Create one polished product screen."),
  },
  "kotikit.create_product_flow": {
    name: "kotikit.create_product_flow",
    title: "Create Product Flow",
    description: "Start the built-in multi-screen product flow.",
    render: (args) =>
      startPrompt("create-product-flow", args.intent ?? "Create a connected product flow."),
  },
  "kotikit.improve_existing_design": {
    name: "kotikit.improve_existing_design",
    title: "Improve Existing Design",
    description: "Review and improve an existing Figma target.",
    render: (args) =>
      startPrompt(
        "improve-existing-design",
        args.intent ?? "Improve the selected Figma design using the local design system."
      ),
  },
  "kotikit.review_comments": {
    name: "kotikit.review_comments",
    title: "Review Comments",
    description: "Turn Figma comments into an approved revision plan.",
    render: (args) =>
      startPrompt("review-comments", args.intent ?? "Review comments and prepare revisions."),
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
        "Use kotikit_flow_list, choose create-screen or create-product-flow, then call kotikit_start.",
        "Read the active Figma transaction from the run result or apply-packet artifact.",
        "Apply one draft component, screen state, or region state with use_figma at the canvas plan bounds.",
        "Record transactionId, node id, bounds, component refs, component source, variable refs, required icon refs, and autoLayout with kotikit_record_figma_apply.",
        "Continue the run and repeat until no active Figma transaction remains.",
        "Use generate_figma_design only for web or HTML capture references, not normal kotikit draft composition.",
      ].join("\n"),
  },
  "kotikit.review_figma_design": {
    name: "kotikit.review_figma_design",
    title: "Review Figma Design",
    description: "Review a Figma design against component, layout, and variable rules.",
    render: (args) =>
      startPrompt(
        "improve-existing-design",
        args.intent ?? "Review the selected Figma design for product-quality UI issues."
      ),
  },
  "kotikit.sync_design_system": {
    name: "kotikit.sync_design_system",
    title: "Sync Design System",
    description: "Refresh kotikit's local design-system mirror.",
    render: (args) =>
      startPrompt("sync-design-system", args.intent ?? "Sync the local design-system cache."),
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
    "Use existing components, variables, and auto-layout before proposing new draft components.",
  ].join("\n");
}
