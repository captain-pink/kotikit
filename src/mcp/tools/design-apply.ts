import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { mkdir, appendFile } from "fs/promises";
import { dirname } from "path";
import { designApplyLogPath } from "../../util/paths.js";
import { nowIso } from "../../util/ids.js";
import { toolText, toolError } from "../../util/result.js";
import { upsertDesignNodeMapEntry } from "../../planning/design-node-map.js";
import type { DesignPlanStepKind } from "../../planning/design-plan-schema.js";
import type { DesignNodeKind } from "../../planning/design-node-map.js";

export function registerDesignApplyTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  registry.tools.push({
    name: "kotikit_design_apply_step",
    description: "Record that the Figma plugin applied a design plan step (audit log).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope (flow or single-screen) slug." },
        screen: { type: "string", description: "Screen slug; omit for single-screen specs." },
        stepIndex: { type: "number", description: "Zero-based index of the step that was applied." },
        outcome: {
          type: "string",
          enum: ["ok", "warned", "failed"],
          description: "Result of the apply.",
        },
        note: { type: "string", description: "Optional human-readable note." },
        stepKind: {
          type: "string",
          enum: ["define-state-frame", "apply-auto-layout", "place-component", "bind-variable"],
          description: "Design plan step kind applied by the Figma plugin.",
        },
        state: { type: "string", description: "Design state affected by the step." },
        componentName: { type: "string", description: "Component name when the step placed a component." },
        dsKey: { type: "string", description: "Design-system component key when available." },
        figmaFileKey: { type: "string", description: "Figma file key containing the applied node." },
        figmaPageId: { type: "string", description: "Figma page ID containing the applied node." },
        figmaPageName: { type: "string", description: "Figma page name containing the applied node." },
        figmaNodeId: { type: "string", description: "Figma node ID created or updated by this step." },
        figmaNodeKind: {
          type: "string",
          enum: ["page", "frame", "instance", "node"],
          description: "Kind of Figma node created or updated by this step.",
        },
        figmaNodeName: { type: "string", description: "Figma node name created or updated by this step." },
      },
      required: ["scope", "stepIndex", "outcome"],
    },
  });

  registry.handlers.set("kotikit_design_apply_step", async (args) => {
    try {
      const { root } = ctx;
      const {
        scope,
        screen,
        stepIndex,
        outcome,
        note,
        stepKind,
        state,
        componentName,
        dsKey,
        figmaFileKey,
        figmaPageId,
        figmaPageName,
        figmaNodeId,
        figmaNodeKind,
        figmaNodeName,
      } = args as {
        scope: string;
        screen?: string;
        stepIndex: number;
        outcome: "ok" | "warned" | "failed";
        note?: string;
        stepKind?: DesignPlanStepKind;
        state?: string;
        componentName?: string;
        dsKey?: string;
        figmaFileKey?: string;
        figmaPageId?: string;
        figmaPageName?: string;
        figmaNodeId?: string;
        figmaNodeKind?: DesignNodeKind;
        figmaNodeName?: string;
      };

      const path = designApplyLogPath(root, scope, screen ?? null);
      await mkdir(dirname(path), { recursive: true });
      const ts = nowIso();

      const line = JSON.stringify({
        ts,
        stepIndex,
        outcome,
        ...(note !== undefined ? { note } : {}),
        ...(stepKind !== undefined ? { stepKind } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(componentName !== undefined ? { componentName } : {}),
        ...(dsKey !== undefined ? { dsKey } : {}),
        ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
        ...(figmaPageId !== undefined ? { figmaPageId } : {}),
        ...(figmaPageName !== undefined ? { figmaPageName } : {}),
        ...(figmaNodeId !== undefined ? { figmaNodeId } : {}),
        ...(figmaNodeKind !== undefined ? { figmaNodeKind } : {}),
        ...(figmaNodeName !== undefined ? { figmaNodeName } : {}),
      });
      await appendFile(path, line + "\n", "utf-8");

      if (figmaNodeId && stepKind && figmaNodeKind) {
        await upsertDesignNodeMapEntry(root, scope, screen ?? null, {
          updatedAt: ts,
          ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
          ...(figmaPageId && figmaPageName ? { page: { id: figmaPageId, name: figmaPageName } } : {}),
          entry: {
            stepIndex,
            stepKind,
            outcome,
            ...(state !== undefined ? { state } : {}),
            ...(componentName !== undefined ? { componentName } : {}),
            ...(dsKey !== undefined ? { dsKey } : {}),
            nodeId: figmaNodeId,
            nodeKind: figmaNodeKind,
            ...(figmaNodeName !== undefined ? { nodeName: figmaNodeName } : {}),
          },
        });
      }

      return toolText(
        `Recorded apply: step ${stepIndex} ${outcome}.`,
        { line }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
