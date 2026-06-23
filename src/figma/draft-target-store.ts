import {
  readFlowManifest,
  readScreenSpec,
  writeFlowManifest,
  writeScreenSpec,
} from "../spec/engine.js";
import type { FlowManifest, ScreenSpec } from "../spec/schema.js";
import { nowIso } from "../util/ids.js";
import type { FigmaDraftTarget } from "./draft-target.js";

const tryReadFlowManifest = async (root: string, scope: string): Promise<FlowManifest | null> => {
  try {
    return await readFlowManifest(root, scope);
  } catch {
    return null;
  }
};

const withTargetMetadata = <T extends ScreenSpec | FlowManifest>(
  artifact: T,
  target: FigmaDraftTarget
): T => ({
  ...artifact,
  figmaTarget: target,
  metadata: {
    ...artifact.metadata,
    updatedAt: nowIso(),
  },
});

export async function readFigmaDraftTarget(
  root: string,
  scope: string,
  screen: string | null
): Promise<FigmaDraftTarget | null> {
  if (screen !== null) {
    const spec = await readScreenSpec(root, scope, screen);
    if (spec.figmaTarget !== undefined) return spec.figmaTarget;
    return (await tryReadFlowManifest(root, scope))?.figmaTarget ?? null;
  }

  const flow = await tryReadFlowManifest(root, scope);
  if (flow?.figmaTarget !== undefined) return flow.figmaTarget;
  return (await readScreenSpec(root, scope, null)).figmaTarget ?? null;
}

export async function writeFigmaDraftTarget(
  root: string,
  scope: string,
  screen: string | null,
  target: FigmaDraftTarget
): Promise<string[]> {
  if (screen !== null) {
    const spec = await readScreenSpec(root, scope, screen);
    return [await writeScreenSpec(root, scope, screen, withTargetMetadata(spec, target))];
  }

  const flow = await tryReadFlowManifest(root, scope);
  if (flow !== null) {
    return [await writeFlowManifest(root, scope, withTargetMetadata(flow, target))];
  }

  const spec = await readScreenSpec(root, scope, null);
  return [await writeScreenSpec(root, scope, null, withTargetMetadata(spec, target))];
}
