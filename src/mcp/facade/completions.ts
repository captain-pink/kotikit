import type { CompleteResult } from "@modelcontextprotocol/sdk/types.js";
import { loadBuiltInFlows } from "../../core/flows/catalog.js";
import type { FlowDefinition } from "../../core/schemas/flow-definition.js";
import { KOTIKIT_PROMPT_NAMES } from "./prompts.js";

export type FacadeCompletionInput = {
  ref: { type: string; name?: string; uri?: string };
  argument: { name: string; value: string };
  context?: { arguments?: Record<string, string> };
};

export type FacadeCompletionDependencies = {
  loadFlows?: () => Promise<FlowDefinition[]>;
};

export async function completeFacadeArgument(
  input: FacadeCompletionInput,
  deps: FacadeCompletionDependencies = {}
): Promise<CompleteResult> {
  if (input.argument.name === "flowId") {
    const flows = await (deps.loadFlows ?? loadBuiltInFlows)();
    return completionResult(
      flows
        .map((flow) => flow.id)
        .filter((id) => id.includes(input.argument.value))
        .sort()
    );
  }

  if (input.argument.name === "promptName" || input.argument.name === "name") {
    return completionResult(
      KOTIKIT_PROMPT_NAMES.filter((name) => name.includes(input.argument.value)).sort()
    );
  }

  return completionResult([]);
}

function completionResult(values: string[]): CompleteResult {
  return {
    completion: {
      values: values.slice(0, 100),
      total: values.length,
      hasMore: values.length > 100,
    },
  };
}
