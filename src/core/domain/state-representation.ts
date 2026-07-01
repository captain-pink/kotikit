import { KotikitError } from "../../util/result.js";
import type { StateMatrix } from "../schemas/artifact.js";

export type StateRepresentationContract = {
  schemaVersion: "StateRepresentationContract/v1";
  states: {
    stateId: string;
    kind: string;
    scope: "page" | "region" | "component" | "flow";
    representation: "screen-frame" | "region-state" | "component-state" | "flow-step";
    replacementBehavior: string;
    persistentRegions: string[];
  }[];
};

type AppliedState = {
  stateId?: unknown;
  representation?: unknown;
  width?: unknown;
  height?: unknown;
  persistentRegions?: unknown;
};

export function buildStateRepresentationContract(input: {
  stateMatrix: StateMatrix;
}): StateRepresentationContract {
  return {
    schemaVersion: "StateRepresentationContract/v1",
    states: input.stateMatrix.states.map((state) => ({
      stateId: state.id,
      kind: state.kind,
      scope: state.scope,
      representation: representationFor(state.scope),
      replacementBehavior: state.replacementBehavior,
      persistentRegions: state.persistentRegions,
    })),
  };
}

export function verifyStateRepresentationMetadata(input: {
  contract: StateRepresentationContract;
  appliedStates: AppliedState[];
}): void {
  input.contract.states.forEach((expected) => {
    const applied = input.appliedStates.find((state) => state.stateId === expected.stateId);
    if (applied === undefined) {
      throw new KotikitError(
        `The applied Figma draft is missing the ${expected.kind} state.`,
        "Create every state recorded in the state matrix before marking the draft complete."
      );
    }
    if (applied.representation === "preview-card" && expected.scope !== "component") {
      throw new KotikitError(
        `The ${expected.kind} state was created as a preview card instead of a ${expected.scope} state.`,
        "Represent loading, empty, and error as page or region states when the state matrix requires it."
      );
    }
    if (applied.representation !== expected.representation) {
      throw new KotikitError(
        `The ${expected.kind} state has the wrong Figma representation.`,
        `Expected ${expected.representation} based on the state matrix.`
      );
    }
  });
}

function representationFor(
  scope: "page" | "region" | "component" | "flow"
): StateRepresentationContract["states"][number]["representation"] {
  if (scope === "page") return "screen-frame";
  if (scope === "region") return "region-state";
  if (scope === "component") return "component-state";
  return "flow-step";
}
