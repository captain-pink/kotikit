import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type BriefClassification = "singleScreen" | "multiScreen";
type BriefLane = "quick" | "guided" | "deep";

type BriefQuestion = {
  id: string;
  prompt: string;
  answer?: string;
};

type BriefModel = {
  schemaVersion: "DesignBriefModel/v1";
  intent: string;
  title: string;
  classification: BriefClassification;
  lane: BriefLane;
  assumptions: string[];
  questions: BriefQuestion[];
  activeQuestionId?: string;
  approvalSummary?: string;
  approved?: boolean;
};

type ScreenBlueprint = {
  schemaVersion: "ScreenModel/v1";
  title: string;
  description: string;
  requiredUiParts: string[];
  repeatedPatterns: string[];
  states: string[];
  regions: {
    tables: string[];
    lists: string[];
    forms: string[];
  };
  designSystemHints: string[];
};

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  artifacts?: Artifact[];
  interrupt?: ReturnType<typeof createUserInterrupt>;
};

const EmptyParamsSchema = z.strictObject({});
const ClassifyParamsSchema = z
  .strictObject({
    lanes: z.array(z.enum(["quick", "guided", "deep"])).optional(),
    quickHighFidelity: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const CaptureParamsSchema = z
  .strictObject({
    lane: z.string().optional(),
  })
  .passthrough();

const DEFAULT_QUESTIONS: BriefQuestion[] = [
  {
    id: "states",
    prompt: "What should this screen show while loading, empty, errored, and filled?",
  },
  {
    id: "interactions",
    prompt: "What is the primary action and what feedback should happen after it?",
  },
  {
    id: "responsive",
    prompt: "How should the screen adapt on phone, tablet, and desktop?",
  },
];

export const briefNodeDefinitions: NodeDefinition[] = [
  node({
    key: "brief.classifyIntent",
    paramsSchema: ClassifyParamsSchema,
    stateReads: ["userIntent", "brief"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const classification = classifyIntent(intent);
      const lane = classifyLane(intent);
      const brief = mergeBrief(state.brief, {
        intent,
        title: titleFromIntent(intent, classification),
        classification,
        lane,
        assumptions: assumptionsForLane(lane),
        questions: questionsForClassification(classification),
      });
      return { statePatch: { brief } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.captureMinimalIntent",
    paramsSchema: CaptureParamsSchema,
    stateReads: ["userIntent", "brief"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const current = briefFrom(state.brief);
      const lane = current.lane ?? classifyLane(intent);
      const classification = current.classification ?? classifyIntent(intent);
      const brief = mergeBrief(current, {
        intent,
        title: current.title ?? titleFromIntent(intent, classification),
        classification,
        lane,
        assumptions: uniqueStrings([
          ...(current.assumptions ?? []),
          ...assumptionsForLane(lane),
          "Use existing design-system components first.",
        ]),
        questions: current.questions?.length
          ? current.questions
          : questionsForClassification(classification),
      });
      return { statePatch: { brief } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.inferScreenBlueprint",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["userIntent", "brief", "designSystem"],
    stateWrites: ["screen"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const classification = briefFrom(state.brief).classification ?? "singleScreen";
      const screen = inferScreenBlueprint(intent, state.designSystem, classification);
      return { statePatch: { screen } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.askNextQuestion",
    kind: "interrupt",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["brief", "answers"],
    stateWrites: ["brief", "pendingQuestion"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = briefFrom(state.brief);
      const questions = current.questions?.length
        ? current.questions
        : questionsForClassification(current.classification ?? "singleScreen");
      const answeredQuestions = applyStoredAnswers(questions, state.answers);
      const question = answeredQuestions.find((candidate) => candidate.answer === undefined);
      if (question === undefined)
        return {
          statePatch: {
            brief: mergeBrief(current, {
              questions: answeredQuestions,
              activeQuestionId: undefined,
            }),
          },
        } satisfies RuntimeNodeOutput;
      return {
        statePatch: {
          brief: mergeBrief(current, {
            questions: answeredQuestions,
            activeQuestionId: question.id,
          }),
        },
        interrupt: createUserInterrupt({
          id: question.id,
          prompt: question.prompt,
        }),
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.recordAnswer",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["brief", "pendingQuestion", "userIntent"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = briefFrom(state.brief);
      const activeQuestionId = current.activeQuestionId ?? state.pendingQuestion?.id;
      const answer = intentFromState(state);
      const questions = (current.questions?.length ? current.questions : DEFAULT_QUESTIONS).map(
        (question) => (question.id === activeQuestionId ? { ...question, answer } : question)
      );
      return {
        statePatch: {
          brief: {
            ...mergeBrief(current, { questions }),
            activeQuestionId: undefined,
          },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.summarizeForApproval",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["brief", "screen"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = briefFrom(state.brief);
      const screen = screenFrom(state.screen);
      const title = current.title ?? screen.title ?? "Untitled Screen";
      const intent = current.intent ?? screen.description ?? title;
      const parts = screen.requiredUiParts?.join(", ") || "design-system components";
      const approvalSummary = `${title}: ${intent}. Build with ${parts} and cover ${STANDARD_STATES.join(
        ", "
      )} states.`;
      return {
        statePatch: {
          brief: mergeBrief(current, { approvalSummary }),
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.askApproval",
    kind: "interrupt",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["brief", "answers"],
    stateWrites: ["brief", "pendingQuestion"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = briefFrom(state.brief);
      const lane = current.lane ?? classifyLane(intentFromState(state));
      const approvalSummary =
        current.approvalSummary ?? current.intent ?? current.title ?? "Approve this design brief.";
      if (current.approved === true || lane === "quick") {
        return {
          statePatch: {
            brief: mergeBrief(current, { approvalSummary, approved: true }),
          },
        } satisfies RuntimeNodeOutput;
      }
      if (state.answers?.["approve-brief"] === "approve-brief") {
        return {
          statePatch: {
            brief: mergeBrief(current, { approvalSummary, approved: true }),
          },
        } satisfies RuntimeNodeOutput;
      }
      return {
        statePatch: {
          brief: mergeBrief(current, { approvalSummary, approved: false }),
        },
        interrupt: createUserInterrupt({
          id: "approve-brief",
          prompt: approvalSummary,
          choices: ["approve-brief"],
        }),
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.saveApproved",
    paramsSchema: EmptyParamsSchema,
    stateReads: ["brief"],
    stateWrites: ["artifacts"],
    sideEffects: "filesystem",
    requiredCapabilities: ["brief.write"],
    run: async (input) => {
      const state = graphState(input.state);
      const current = briefFrom(state.brief);
      if (current.approved !== true) {
        throw new KotikitError(
          "This design brief has not been approved yet.",
          "Ask the designer to approve the summary before saving the design-brief artifact."
        );
      }
      const summary =
        current.approvalSummary ?? current.intent ?? current.title ?? "Approved design brief";
      const artifact: Artifact = {
        id: `${state.runId}-design-brief`,
        runId: state.runId,
        type: "design-brief",
        schemaVersion: ArtifactSchemaVersionByType["design-brief"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        sourceNode: { key: "brief.saveApproved", version: "1.0.0" },
        payload: {
          schemaVersion: ArtifactSchemaVersionByType["design-brief"],
          summary,
          refs: current.questions
            ?.filter((question) => question.answer !== undefined)
            .map((question) => `${question.id}: ${question.answer}`),
        },
      };
      return { artifacts: [artifact] } satisfies RuntimeNodeOutput;
    },
  }),
];

const STANDARD_STATES = ["loading", "empty", "error", "filled"];

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

function intentFromState(state: KotikitGraphState): string {
  return state.userIntent?.trim() || "Create a product screen.";
}

function classifyIntent(intent: string): BriefClassification {
  const lower = intent.toLowerCase();
  const multiSignals = ["flow", "onboarding", "checkout", "wizard", "journey", "steps"];
  if (multiSignals.some((signal) => lower.includes(signal))) return "multiScreen";
  const screenNouns = ["login", "profile", "settings", "payment", "confirmation", "success"];
  const matched = screenNouns.filter((noun) => lower.includes(noun));
  return matched.length >= 2 ? "multiScreen" : "singleScreen";
}

function classifyLane(intent: string): BriefLane {
  const lower = intent.toLowerCase();
  if (
    lower.includes("quick") ||
    lower.includes("fast") ||
    lower.includes("high-fidelity") ||
    lower.includes("high fidelity") ||
    lower.includes("existing ds") ||
    lower.includes("existing design-system")
  ) {
    return "quick";
  }
  if (lower.includes("deep") || lower.includes("research") || lower.includes("comprehensive")) {
    return "deep";
  }
  return "guided";
}

function assumptionsForLane(lane: BriefLane): string[] {
  return lane === "quick"
    ? [
        "Use existing design-system components first.",
        "Record assumptions instead of blocking on low-risk details.",
      ]
    : ["Ask only for decisions that materially affect the design."];
}

function questionsForClassification(classification: BriefClassification): BriefQuestion[] {
  return classification === "multiScreen"
    ? [
        ...DEFAULT_QUESTIONS,
        {
          id: "flowConnectivity",
          prompt: "How does the user enter, move through, and complete this flow?",
        },
      ]
    : DEFAULT_QUESTIONS;
}

function applyStoredAnswers(
  questions: BriefQuestion[],
  answers: Record<string, string> | undefined
): BriefQuestion[] {
  if (answers === undefined) return questions;
  return questions.map((question) =>
    question.answer === undefined && answers[question.id] !== undefined
      ? { ...question, answer: answers[question.id] }
      : question
  );
}

function mergeBrief(current: unknown, patch: Partial<BriefModel>): BriefModel {
  const base = briefFrom(current);
  return {
    schemaVersion: "DesignBriefModel/v1",
    intent: base.intent ?? patch.intent ?? "Create a product screen.",
    title: base.title ?? patch.title ?? "Product Screen",
    classification: base.classification ?? patch.classification ?? "singleScreen",
    lane: base.lane ?? patch.lane ?? "guided",
    assumptions: patch.assumptions ?? base.assumptions ?? [],
    questions: patch.questions ?? base.questions ?? DEFAULT_QUESTIONS,
    ...(base.activeQuestionId !== undefined ? { activeQuestionId: base.activeQuestionId } : {}),
    ...(base.approvalSummary !== undefined ? { approvalSummary: base.approvalSummary } : {}),
    ...(base.approved !== undefined ? { approved: base.approved } : {}),
    ...patch,
  };
}

function briefFrom(value: unknown): Partial<BriefModel> {
  return isRecord(value) ? (value as Partial<BriefModel>) : {};
}

function screenFrom(value: unknown): Partial<ScreenBlueprint> {
  return isRecord(value) ? (value as Partial<ScreenBlueprint>) : {};
}

function inferScreenBlueprint(
  intent: string,
  designSystem: unknown,
  classification: BriefClassification
): ScreenBlueprint {
  const lower = intent.toLowerCase();
  const isTable = lower.includes("table") || lower.includes("members") || lower.includes("admin");
  const isForm = lower.includes("form") || lower.includes("settings") || lower.includes("profile");
  const isList = lower.includes("list") || lower.includes("feed") || lower.includes("cards");
  const requiredUiParts = uniqueStrings([
    "page shell",
    "content heading",
    "primary action",
    ...(isTable ? ["toolbar", "search", "filters", "data table", "pagination"] : []),
    ...(isForm ? ["form fields", "secondary action"] : []),
    ...(isList ? ["list container", "list item"] : []),
  ]);
  return {
    schemaVersion: "ScreenModel/v1",
    title: titleFromIntent(intent, classification),
    description: intent,
    requiredUiParts,
    repeatedPatterns: [
      ...(isTable ? ["table rows"] : []),
      ...(isList ? ["list items"] : []),
      ...(isForm ? ["form field rows"] : []),
    ],
    states: STANDARD_STATES,
    regions: {
      tables: isTable ? [regionName(intent, "members")] : [],
      lists: isList ? [regionName(intent, "items")] : [],
      forms: isForm ? [regionName(intent, "details")] : [],
    },
    designSystemHints: designSystemHints(designSystem, requiredUiParts),
  };
}

function titleFromIntent(intent: string, classification: BriefClassification): string {
  const lower = intent.toLowerCase();
  if (lower.includes("members") && lower.includes("table")) return "Members Table";
  if (lower.includes("onboarding")) return "Onboarding Flow";
  const cleaned = lower
    .replace(
      /\b(create|make|build|design|fast|quick|high-fidelity|high fidelity|screen|page|flow)\b/g,
      " "
    )
    .replace(/\b(from|with|using|existing|components|component|design-system|ds)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, classification === "multiScreen" ? 4 : 3)
    .join(" ");
  return titleCase(
    cleaned || (classification === "multiScreen" ? "Product Flow" : "Product Screen")
  );
}

function regionName(intent: string, fallback: string): string {
  const lower = intent.toLowerCase();
  if (lower.includes("members")) return "members";
  if (lower.includes("teammates")) return "teammates";
  if (lower.includes("settings")) return "settings";
  return fallback;
}

function designSystemHints(designSystem: unknown, requiredUiParts: string[]): string[] {
  const components = componentHints(designSystem);
  if (components.length === 0) return [];
  const normalizedParts = requiredUiParts.map(normalizeToken);
  return components.filter((component) => {
    const normalizedComponent = normalizeToken(component);
    return normalizedParts.some(
      (part) => normalizedComponent.includes(part) || part.includes(normalizedComponent)
    );
  });
}

function componentHints(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const components = value.components;
  if (!Array.isArray(components)) return [];
  return components.filter((component): component is string => typeof component === "string");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
