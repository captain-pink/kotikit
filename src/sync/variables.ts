import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { variablesJsonPath } from "../util/paths.js";
import type {
  FigmaLocalVariables,
  FigmaStyle,
  FigmaNode,
} from "./figma-types.js";

// ─── Output schema ───────────────────────────────────────────────────────────

export const VariableEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["color", "text", "effect", "number", "spacing"]),
  source: z.enum(["variable", "style"]),
  value: z.unknown(),
  modes: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});
export type VariableEntry = z.infer<typeof VariableEntrySchema>;

export const VariablesJsonSchema = z.object({
  version: z.literal(1),
  entries: z.array(VariableEntrySchema),
  collisions: z.array(z.object({
    name: z.string(),
    keptSource: z.enum(["variable", "style"]),
  })).default([]),
});
export type VariablesJson = z.infer<typeof VariablesJsonSchema>;

// ─── Internal helpers ────────────────────────────────────────────────────────

function styleTypeToKind(styleType: FigmaStyle["style_type"]): VariableEntry["kind"] | null {
  switch (styleType) {
    case "FILL":   return "color";
    case "TEXT":   return "text";
    case "EFFECT": return "effect";
    case "GRID":   return null; // skipped — not modelled
  }
}

function variableTypeToKind(resolved: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR"): VariableEntry["kind"] | null {
  switch (resolved) {
    case "COLOR":   return "color";
    case "FLOAT":   return "number";
    case "STRING":  return "text";
    case "BOOLEAN": return null; // skipped — not modelled
  }
}

// ─── The merge ───────────────────────────────────────────────────────────────

/**
 * Merge Figma local variables (may be null) and styles into one VariablesJson.
 *
 *  Rules:
 *   - Each style becomes one entry with source: "style", kind inferred from style_type.
 *   - Each variable becomes one entry with source: "variable", kind from resolvedType.
 *     If it has multiple modes, `modes` is populated keyed by mode display name.
 *   - On name collision between a variable and a style, the variable wins; collision recorded.
 *   - GRID styles and BOOLEAN variables are skipped (not modelled in V1).
 */
export function mergeVariables(input: {
  variables: FigmaLocalVariables | null;
  styles: FigmaStyle[];
  styleDetailsByNodeId: Record<string, FigmaNode>;
}): VariablesJson {
  const styleEntries: VariableEntry[] = [];
  for (const style of input.styles) {
    const kind = styleTypeToKind(style.style_type);
    if (kind === null) continue;
    const detail = style.node_id ? input.styleDetailsByNodeId[style.node_id] : undefined;
    const entry: VariableEntry = {
      name: style.name,
      kind,
      source: "style",
      value: detail?.document ?? null,
      ...(style.description !== undefined ? { description: style.description } : {}),
    };
    styleEntries.push(entry);
  }

  const variableEntries: VariableEntry[] = [];
  if (input.variables?.variables) {
    // Build a mode name lookup from collections so modes can be keyed by display name
    const modeNameById: Record<string, string> = {};
    if (input.variables.variableCollections) {
      for (const collection of Object.values(input.variables.variableCollections)) {
        for (const mode of collection.modes ?? []) {
          modeNameById[mode.modeId] = mode.name;
        }
      }
    }

    for (const v of Object.values(input.variables.variables)) {
      const kind = variableTypeToKind(v.resolvedType);
      if (kind === null) continue;
      const valuesByMode = v.valuesByMode ?? {};
      const modeIds = Object.keys(valuesByMode);
      const entry: VariableEntry = {
        name: v.name,
        kind,
        source: "variable",
        // value defaults to the first mode's value for the single-mode case
        value: modeIds.length > 0 ? valuesByMode[modeIds[0] as string] : null,
        ...(v.description !== undefined ? { description: v.description } : {}),
      };
      if (modeIds.length > 1) {
        const modes: Record<string, unknown> = {};
        for (const modeId of modeIds) {
          const modeName = modeNameById[modeId] ?? modeId;
          modes[modeName] = valuesByMode[modeId];
        }
        entry.modes = modes;
      }
      variableEntries.push(entry);
    }
  }

  // Collide: variables win over styles on name match
  const variableNames = new Set(variableEntries.map((e) => e.name));
  const collisions: VariablesJson["collisions"] = [];
  const finalEntries: VariableEntry[] = [...variableEntries];
  for (const styleEntry of styleEntries) {
    if (variableNames.has(styleEntry.name)) {
      collisions.push({ name: styleEntry.name, keptSource: "variable" });
      continue;
    }
    finalEntries.push(styleEntry);
  }

  return VariablesJsonSchema.parse({
    version: 1,
    entries: finalEntries,
    collisions,
  });
}

/** Write VariablesJson to design-system/variables.json (pretty JSON + newline). */
export async function writeVariablesJson(root: string, data: VariablesJson): Promise<void> {
  VariablesJsonSchema.parse(data);
  const path = variablesJsonPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
