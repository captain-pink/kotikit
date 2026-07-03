import { z } from "zod";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import {
  type CanvasIntentInput,
  type ExistingDesignInventoryInput,
  type FlowBlueprintInput,
  primaryScreenFromFlowBlueprint,
  type ScreenBlueprintInput,
} from "../../schemas/blueprint.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
};

type RefineTarget = Extract<
  CanvasIntentInput,
  { mode: "refine-existing-targets" }
>["targets"][number];

const EmptyParamsSchema = z.strictObject({});

export const refineNodeDefinitions: NodeDefinition[] = [
  node({
    key: "refine.mapExistingTargets",
    kind: "interrupt",
    stateReads: [
      "canvasIntent",
      "existingDesignInventory",
      "flowBlueprint",
      "screenBlueprint",
      "answers",
    ],
    stateWrites: ["canvasIntent", "pendingQuestion"],
    run: async (input) => {
      const state = graphState(input.state);
      const intent = state.canvasIntent;
      if (intent?.mode !== "refine-existing-targets") return {} satisfies RuntimeNodeOutput;

      const targets = refineTargetsFrom(state, intent);
      const selectedAnswer = state.answers?.["select-refine-target"];
      const target =
        targetForAnswer(targets, selectedAnswer) ??
        targetForBlueprint(targets, state.flowBlueprint, state.screenBlueprint) ??
        (targets.length === 1 ? targets[0] : undefined);

      if (target !== undefined) {
        return {
          statePatch: {
            canvasIntent: {
              mode: "replace-existing-frame",
              targetFrame: target,
            },
          },
        } satisfies RuntimeNodeOutput;
      }

      const pendingQuestion = {
        id: "select-refine-target",
        prompt: "Which existing frame should kotikit refine first?",
        choices: targets.map((candidate) => candidate.nodeId),
      };
      return {
        statePatch: { pendingQuestion },
        interrupt: createUserInterrupt(pendingQuestion),
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function refineTargetsFrom(
  state: KotikitGraphState,
  intent: Extract<CanvasIntentInput, { mode: "refine-existing-targets" }>
): RefineTarget[] {
  if (intent.targets.length > 0) return intent.targets;
  return targetsFromInventory(state.existingDesignInventory);
}

function targetsFromInventory(inventory: ExistingDesignInventoryInput | undefined): RefineTarget[] {
  return (
    inventory?.targets.map((target) => ({
      nodeId: target.nodeId,
      ...(target.screenId === undefined ? {} : { screenId: target.screenId }),
      name: target.name,
      ...(target.bounds === undefined ? {} : { bounds: target.bounds }),
    })) ?? []
  );
}

function targetForAnswer(
  targets: RefineTarget[],
  selectedAnswer: string | undefined
): RefineTarget | undefined {
  if (selectedAnswer === undefined) return undefined;
  return targets.find((candidate) => candidate.nodeId === selectedAnswer);
}

function targetForBlueprint(
  targets: RefineTarget[],
  flowBlueprint: FlowBlueprintInput | undefined,
  screenBlueprint: ScreenBlueprintInput | undefined
): RefineTarget | undefined {
  const preferredScreenId =
    flowBlueprintScreenId(flowBlueprint) ?? screenBlueprint?.id ?? screenBlueprint?.title;
  if (preferredScreenId === undefined) return undefined;
  return targets.find(
    (target) =>
      target.screenId === preferredScreenId ||
      normalized(target.name) === normalized(preferredScreenId)
  );
}

function flowBlueprintScreenId(flowBlueprint: FlowBlueprintInput | undefined): string | undefined {
  if (flowBlueprint === undefined) return undefined;
  return (
    flowBlueprint.primaryScreenId ??
    flowBlueprint.entryScreenId ??
    primaryScreenFromFlowBlueprint(flowBlueprint).id ??
    primaryScreenFromFlowBlueprint(flowBlueprint).title
  );
}

function normalized(value: string | undefined): string | undefined {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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
