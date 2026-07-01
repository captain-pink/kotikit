import { z } from "zod";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type FlowStep = {
  id: string;
  title: string;
  goal: string;
};

type FlowScreen = FlowStep & {
  states: string[];
  requiredUiParts: string[];
  repeatedPatterns: string[];
  regions: {
    tables: string[];
    lists: string[];
    forms: string[];
  };
};

type FlowModel = {
  schemaVersion: "FlowModel/v1";
  actor: string;
  goal: string;
  scenario: string;
  steps?: FlowStep[];
  transitions?: { from: string; to: string; trigger: string }[];
  screens?: FlowScreen[];
};

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
};

const EmptyParamsSchema = z.strictObject({});
const STANDARD_STATES = ["loading", "empty", "error", "filled"];

export const flowNodeDefinitions: NodeDefinition[] = [
  node({
    key: "flow.captureGoalActorScenario",
    stateReads: ["userIntent", "flowModel"],
    stateWrites: ["flowModel"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = state.userIntent ?? "Create a product flow.";
      const existing = flowModelFrom(state.flowModel);
      return {
        statePatch: {
          flowModel: {
            schemaVersion: "FlowModel/v1",
            actor: existing.actor ?? actorFromIntent(intent),
            goal: existing.goal ?? goalFromIntent(intent),
            scenario: existing.scenario ?? scenarioFromIntent(intent),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "flow.mapUserFlow",
    stateReads: ["flowModel", "userIntent"],
    stateWrites: ["flowModel"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = flowModelFrom(state.flowModel);
      const intent = state.userIntent ?? `${current.goal} ${current.scenario}`;
      const steps = stepsFromIntent(intent, current);
      return {
        statePatch: {
          flowModel: {
            ...current,
            schemaVersion: "FlowModel/v1",
            steps,
            transitions: transitionsForSteps(steps),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "flow.identifyScreensAndStates",
    stateReads: ["flowModel", "userIntent"],
    stateWrites: ["flowModel"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = flowModelFrom(state.flowModel);
      const steps = current.steps?.length
        ? current.steps
        : stepsFromIntent(state.userIntent ?? "", current);
      return {
        statePatch: {
          flowModel: {
            ...current,
            schemaVersion: "FlowModel/v1",
            steps,
            transitions: current.transitions ?? transitionsForSteps(steps),
            screens: steps.map(screenForStep),
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function flowModelFrom(value: unknown): Partial<FlowModel> {
  return isRecord(value) ? (value as Partial<FlowModel>) : {};
}

function actorFromIntent(intent: string): string {
  const lower = intent.toLowerCase();
  const match = /\bfor\s+(.+?)\s+(?:so|to|who|that)\b/.exec(lower);
  return match?.[1]?.trim() || "users";
}

function goalFromIntent(intent: string): string {
  const lower = intent.toLowerCase();
  const soMatch = /\bso\s+(?:they|users|admins|people)\s+can\s+(.+?)(?:\s+and\s+|\.|$)/.exec(lower);
  if (soMatch?.[1] !== undefined) return soMatch[1].trim();
  const toMatch = /\bto\s+(.+?)(?:\s+and\s+|\.|$)/.exec(lower);
  return toMatch?.[1]?.trim() || lower.trim();
}

function scenarioFromIntent(intent: string): string {
  const lower = intent.toLowerCase();
  const andMatch = /\band\s+(.+?)(?:\.|$)/.exec(lower);
  if (andMatch?.[1] !== undefined) return andMatch[1].trim();
  if (lower.includes("onboarding")) return "complete onboarding";
  return "complete the task";
}

function stepsFromIntent(intent: string, model: Partial<FlowModel>): FlowStep[] {
  const lower = `${intent} ${model.goal ?? ""} ${model.scenario ?? ""}`.toLowerCase();
  if (lower.includes("onboarding")) {
    return [
      { id: "welcome", title: "Welcome", goal: "orient the user" },
      { id: "invite-teammates", title: "Invite Teammates", goal: "invite teammates" },
      { id: "finish-setup", title: "Finish Setup", goal: "finish setup" },
    ];
  }
  if (lower.includes("checkout")) {
    return [
      { id: "cart", title: "Cart", goal: "review selected items" },
      { id: "shipping", title: "Shipping", goal: "enter shipping details" },
      { id: "payment", title: "Payment", goal: "confirm payment" },
      { id: "confirmation", title: "Confirmation", goal: "finish checkout" },
    ];
  }
  const goal = model.goal ?? goalFromIntent(intent);
  const scenario = model.scenario ?? scenarioFromIntent(intent);
  return [
    { id: "start", title: "Start", goal: "enter the flow" },
    { id: slugify(goal), title: titleCase(goal), goal },
    { id: slugify(scenario), title: titleCase(scenario), goal: scenario },
  ];
}

function transitionsForSteps(steps: FlowStep[]): { from: string; to: string; trigger: string }[] {
  return steps.slice(0, -1).map((step, index) => ({
    from: step.id,
    to: steps[index + 1]?.id ?? step.id,
    trigger: "continue",
  }));
}

function screenForStep(step: FlowStep): FlowScreen {
  const lower = `${step.id} ${step.title} ${step.goal}`.toLowerCase();
  const isInvite = lower.includes("invite") || lower.includes("teammate");
  const isReview = lower.includes("review") || lower.includes("cart");
  return {
    ...step,
    states: STANDARD_STATES,
    requiredUiParts: [
      "content heading",
      "primary action",
      ...(isInvite ? ["form fields", "email input", "role selector"] : []),
      ...(isReview ? ["summary list", "price summary"] : []),
    ],
    repeatedPatterns: [...(isInvite ? ["invite rows"] : []), ...(isReview ? ["summary rows"] : [])],
    regions: {
      tables: [],
      lists: isReview ? [step.goal] : [],
      forms: isInvite ? [step.goal] : [],
    },
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
