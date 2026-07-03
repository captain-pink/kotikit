import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import { type Artifact, ArtifactSchemaVersionByType } from "../../schemas/artifact.js";
import {
  type FlowBlueprintInput,
  primaryScreenFromFlowBlueprint,
  type ScreenBlueprintInput,
} from "../../schemas/blueprint.js";
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
  confidence?: "explicit" | "inferred" | "low";
  activeQuestionId?: string;
  approvalSummary?: string;
  approved?: boolean;
};

type ScreenModel = {
  schemaVersion: "ScreenModel/v1";
  title: string;
  productDomain?: string;
  description: string;
  confidence?: "explicit" | "inferred" | "low";
  requiredUiParts: string[];
  uiParts?: ScreenBlueprintInput["requiredUiParts"];
  repeatedPatterns: string[];
  states: string[];
  regions: {
    tables: string[];
    lists: string[];
    forms: string[];
    custom?: string[];
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
    stateReads: ["userIntent", "brief", "screenBlueprint", "flowBlueprint"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const classification = classificationForState(state, intent);
      const lane = classifyLane(intent);
      const brief = mergeBrief(state.brief, {
        intent,
        title: titleForState(state, intent, classification),
        classification,
        lane,
        confidence: confidenceForState(state, intent),
        assumptions: assumptionsForLane(lane),
        questions: questionsForClassification(classification),
      });
      return { statePatch: { brief } } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "brief.captureMinimalIntent",
    paramsSchema: CaptureParamsSchema,
    stateReads: ["userIntent", "brief", "screenBlueprint", "flowBlueprint"],
    stateWrites: ["brief"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const current = briefFrom(state.brief);
      const lane = current.lane ?? classifyLane(intent);
      const classification = current.classification ?? classificationForState(state, intent);
      const brief = mergeBrief(current, {
        intent,
        title: current.title ?? titleForState(state, intent, classification),
        classification,
        lane,
        confidence: current.confidence ?? confidenceForState(state, intent),
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
    stateReads: ["userIntent", "brief", "designSystem", "screenBlueprint", "flowBlueprint"],
    stateWrites: ["screen", "flowModel"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = intentFromState(state);
      const classification = briefFrom(state.brief).classification ?? "singleScreen";
      const blueprint = screenBlueprintForState(state);
      if (blueprint !== undefined) {
        return {
          statePatch: {
            screen: screenModelFromBlueprint(blueprint.screen, intent, state.designSystem),
            ...(blueprint.flowModel === undefined ? {} : { flowModel: blueprint.flowModel }),
          },
        } satisfies RuntimeNodeOutput;
      }
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
const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "build",
  "component",
  "components",
  "create",
  "design",
  "ds",
  "existing",
  "fast",
  "fidelity",
  "flow",
  "for",
  "from",
  "high",
  "make",
  "mock",
  "mocked",
  "page",
  "quick",
  "screen",
  "system",
  "the",
  "using",
  "with",
]);

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

function classificationForState(state: KotikitGraphState, intent: string): BriefClassification {
  if (state.flowBlueprint !== undefined) return "multiScreen";
  if (state.screenBlueprint !== undefined) return "singleScreen";
  return classifySimpleIntent(intent);
}

function classifySimpleIntent(intent: string): BriefClassification {
  if (!isShortPrompt(intent)) return "singleScreen";
  const words = wordsFrom(intent);
  return words.includes("flow") || words.includes("wizard") ? "multiScreen" : "singleScreen";
}

function titleForState(
  state: KotikitGraphState,
  intent: string,
  classification: BriefClassification
): string {
  if (state.screenBlueprint?.title !== undefined) return state.screenBlueprint.title;
  if (state.flowBlueprint?.title !== undefined) return state.flowBlueprint.title;
  return titleFromSimpleIntent(intent, classification);
}

function confidenceForState(
  state: KotikitGraphState,
  intent: string
): "explicit" | "inferred" | "low" {
  if (state.screenBlueprint !== undefined || state.flowBlueprint !== undefined) return "explicit";
  return isDetailedIntent(intent) ? "low" : "inferred";
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
    ...(base.confidence !== undefined ? { confidence: base.confidence } : {}),
    ...(base.activeQuestionId !== undefined ? { activeQuestionId: base.activeQuestionId } : {}),
    ...(base.approvalSummary !== undefined ? { approvalSummary: base.approvalSummary } : {}),
    ...(base.approved !== undefined ? { approved: base.approved } : {}),
    ...patch,
  };
}

function briefFrom(value: unknown): Partial<BriefModel> {
  return isRecord(value) ? (value as Partial<BriefModel>) : {};
}

function screenFrom(value: unknown): Partial<ScreenModel> {
  return isRecord(value) ? (value as Partial<ScreenModel>) : {};
}

function inferScreenBlueprint(
  intent: string,
  designSystem: unknown,
  classification: BriefClassification
): ScreenModel {
  if (isDetailedIntent(intent)) {
    return genericLowConfidenceScreen(intent, designSystem, classification);
  }
  return inferSimpleScreenBlueprint(intent, designSystem, classification);
}

function screenBlueprintForState(state: KotikitGraphState):
  | {
      screen: ScreenBlueprintInput;
      flowModel?: Record<string, unknown>;
    }
  | undefined {
  if (state.flowBlueprint !== undefined) {
    return {
      screen: primaryScreenFromFlowBlueprint(state.flowBlueprint),
      flowModel: flowModelFromBlueprint(state.flowBlueprint),
    };
  }
  if (state.screenBlueprint !== undefined) return { screen: state.screenBlueprint };
  return undefined;
}

function screenModelFromBlueprint(
  blueprint: ScreenBlueprintInput,
  userIntent: string,
  designSystem: unknown
): ScreenModel {
  const requiredUiParts = blueprint.requiredUiParts.map((part) => part.name);
  return {
    schemaVersion: "ScreenModel/v1",
    title: blueprint.title,
    ...(blueprint.productDomain === undefined ? {} : { productDomain: blueprint.productDomain }),
    description: blueprint.description ?? userIntent ?? blueprint.title,
    confidence: blueprint.confidence ?? "explicit",
    requiredUiParts,
    uiParts: blueprint.requiredUiParts,
    repeatedPatterns: repeatedPatternsFromBlueprint(blueprint),
    states:
      blueprint.states?.map((state) => state.kind).filter((state) => state.trim().length > 0) ??
      STANDARD_STATES,
    regions: regionsFromBlueprint(blueprint),
    designSystemHints:
      blueprint.designSystemHints ?? designSystemHints(designSystem, requiredUiParts),
  };
}

function flowModelFromBlueprint(flow: FlowBlueprintInput): Record<string, unknown> {
  return {
    schemaVersion: "FlowModel/v1",
    title: flow.title,
    ...(flow.productDomain === undefined ? {} : { productDomain: flow.productDomain }),
    ...(flow.primaryScreenId === undefined ? {} : { primaryScreenId: flow.primaryScreenId }),
    ...(flow.entryScreenId === undefined ? {} : { entryScreenId: flow.entryScreenId }),
    screens: flow.screens.map((screen) => ({
      ...(screen.id === undefined ? {} : { id: screen.id }),
      title: screen.title,
      ...(screen.productDomain === undefined ? {} : { productDomain: screen.productDomain }),
      requiredUiParts: screen.requiredUiParts.map((part) => part.name),
    })),
  };
}

function repeatedPatternsFromBlueprint(blueprint: ScreenBlueprintInput): string[] {
  return uniqueStrings([
    ...(blueprint.repeatedPatterns ?? []).map((pattern) => pattern.name),
    ...(blueprint.traits?.repeatedPatterns ?? []).map((pattern) => pattern.name),
  ]);
}

function regionsFromBlueprint(blueprint: ScreenBlueprintInput): ScreenModel["regions"] {
  const regions = [...(blueprint.regions ?? []), ...(blueprint.traits?.regions ?? [])];
  return {
    tables: regions.filter((region) => region.kind === "table").map((region) => region.name),
    lists: regions.filter((region) => region.kind === "list").map((region) => region.name),
    forms: regions.filter((region) => region.kind === "form").map((region) => region.name),
    custom: regions
      .filter((region) => !["table", "list", "form"].includes(region.kind))
      .map((region) => region.name),
  };
}

function genericLowConfidenceScreen(
  intent: string,
  designSystem: unknown,
  classification: BriefClassification
): ScreenModel {
  const requiredUiParts = ["page shell", "content heading", "primary action"];
  return {
    schemaVersion: "ScreenModel/v1",
    title: classification === "multiScreen" ? "Product Flow" : "Product Screen",
    description: intent,
    confidence: "low",
    requiredUiParts,
    repeatedPatterns: [],
    states: STANDARD_STATES,
    regions: { tables: [], lists: [], forms: [], custom: [] },
    designSystemHints: designSystemHints(designSystem, requiredUiParts),
  };
}

function inferSimpleScreenBlueprint(
  intent: string,
  designSystem: unknown,
  classification: BriefClassification
): ScreenModel {
  const words = wordsFrom(intent);
  const isTable = isShortPrompt(intent) && words.includes("table");
  const isForm = isShortPrompt(intent) && words.includes("form");
  const isList =
    isShortPrompt(intent) &&
    (words.includes("list") || words.includes("feed") || words.includes("cards"));
  const requiredUiParts = uniqueStrings([
    "page shell",
    "content heading",
    "primary action",
    ...(isTable
      ? [
          "toolbar",
          "search",
          "filters",
          "data table",
          "pagination",
          "row avatar",
          "status badge",
          "row action menu",
        ]
      : []),
    ...(isForm ? ["form fields", "secondary action"] : []),
    ...(isList ? ["list container", "list item"] : []),
  ]);
  return {
    schemaVersion: "ScreenModel/v1",
    title: titleFromSimpleIntent(intent, classification),
    description: intent,
    confidence: "inferred",
    requiredUiParts,
    repeatedPatterns: [
      ...(isTable ? ["table rows"] : []),
      ...(isList ? ["list items"] : []),
      ...(isForm ? ["form field rows"] : []),
    ],
    states: STANDARD_STATES,
    regions: {
      tables: isTable ? [tableRegionName(words)] : [],
      lists: isList ? ["items"] : [],
      forms: isForm ? ["details"] : [],
      custom: [],
    },
    designSystemHints: designSystemHints(designSystem, requiredUiParts),
  };
}

function titleFromSimpleIntent(intent: string, classification: BriefClassification): string {
  if (isDetailedIntent(intent)) {
    return classification === "multiScreen" ? "Product Flow" : "Product Screen";
  }
  const words = wordsFrom(intent);
  if (words.includes("table")) return `${titleCase(tableRegionName(words))} Table`;
  const titleWords = words
    .filter((word) => !TITLE_STOP_WORDS.has(word))
    .slice(0, classification === "multiScreen" ? 4 : 3);
  return titleCase(
    titleWords.join(" ") || (classification === "multiScreen" ? "Product Flow" : "Product Screen")
  );
}

function tableRegionName(words: string[]): string {
  const tableIndex = words.indexOf("table");
  const previous = tableIndex > 0 ? words[tableIndex - 1] : undefined;
  return previous === undefined || TITLE_STOP_WORDS.has(previous) || previous === "data"
    ? "items"
    : previous;
}

function isDetailedIntent(intent: string): boolean {
  return wordsFrom(intent).length > 24;
}

function isShortPrompt(intent: string): boolean {
  return wordsFrom(intent).length <= 18;
}

function wordsFrom(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
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
