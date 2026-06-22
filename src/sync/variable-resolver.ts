import { readFile } from "fs/promises";
import { variablesJsonPath } from "../util/paths.js";
import { VariablesJsonSchema, type VariableEntry, type VariablesJson } from "./variables.js";

export interface ResolveVariableInput {
  kind: VariableEntry["kind"];
  nameHints?: string[];
}

export interface VariableAvailabilitySummary {
  hasVariablesFile: boolean;
  hasUsableVariables: boolean;
  shouldSuggestPluginSync: boolean;
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const scoreEntry = (entry: VariableEntry, hints: string[]): number => {
  const normalizedName = normalize(entry.name);
  const hintScore = hints.reduce((score, hint) => {
    const normalizedHint = normalize(hint);
    if (normalizedHint.length === 0) return score;
    if (normalizedName === normalizedHint) return score + 100;
    if (normalizedName.includes(normalizedHint)) return score + 20;
    return score;
  }, 0);
  const sourceScore = entry.source === "variable" ? 10 : 0;
  const importScore = entry.key !== undefined ? 2 : entry.id !== undefined ? 1 : 0;

  return hintScore + sourceScore + importScore;
};

export function resolveVariable(
  variables: VariablesJson,
  input: ResolveVariableInput
): VariableEntry | null {
  const entries = variables.entries.filter((entry) => entry.kind === input.kind);
  if (entries.length === 0) return null;

  const hints = input.nameHints ?? [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, hints) }))
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))[0]?.entry ?? null;
}

export function hasUsableVariables(variables: VariablesJson): boolean {
  return variables.entries.some((entry) => entry.source === "variable");
}

export function summarizeVariableAvailability(
  variables: VariablesJson | null
): VariableAvailabilitySummary {
  const usable = variables !== null && hasUsableVariables(variables);
  return {
    hasVariablesFile: variables !== null,
    hasUsableVariables: usable,
    shouldSuggestPluginSync: !usable,
  };
}

export async function readVariablesJson(root: string): Promise<VariablesJson | null> {
  try {
    const text = await readFile(variablesJsonPath(root), "utf-8");
    return VariablesJsonSchema.parse(JSON.parse(text));
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}
