import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { isDraftPageName } from "../../figma/draft-target.js";
import { readFigmaDraftTarget } from "../../figma/draft-target-store.js";
import type { DesignNodeKind } from "../../planning/design-node-map.js";
import { upsertDesignNodeMapEntry } from "../../planning/design-node-map.js";
import {
  DESIGN_PLAN_STEP_KINDS,
  type DesignPlanStepKind,
} from "../../planning/design-plan-schema.js";
import { nowIso } from "../../util/ids.js";
import { designApplyLogPath } from "../../util/paths.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

export function registerDesignApplyTools(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_design_apply_step",
    description: "Record that the Figma plugin applied a design plan step (audit log).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope (flow or single-screen) slug." },
        screen: { type: "string", description: "Screen slug; omit for single-screen specs." },
        stepIndex: {
          type: "number",
          description: "Zero-based index of the step that was applied.",
        },
        outcome: {
          type: "string",
          enum: ["ok", "warned", "failed"],
          description: "Result of the apply.",
        },
        note: { type: "string", description: "Optional human-readable note." },
        stepKind: {
          type: "string",
          enum: [...DESIGN_PLAN_STEP_KINDS],
          description: "Design plan step kind applied by the Figma plugin.",
        },
        state: { type: "string", description: "Design state affected by the step." },
        componentName: {
          type: "string",
          description: "Component name when the step placed a component.",
        },
        dsKey: { type: "string", description: "Design-system component key when available." },
        figmaFileKey: {
          type: "string",
          description: "Figma file key containing the applied node.",
        },
        figmaPageId: { type: "string", description: "Figma page ID containing the applied node." },
        figmaPageName: {
          type: "string",
          description: "Figma page name containing the applied node.",
        },
        figmaPageUrl: { type: "string", description: "Figma page URL bound for this design." },
        figmaSectionId: {
          type: "string",
          description: "Kotikit-owned Figma section ID containing the applied node.",
        },
        figmaSectionName: {
          type: "string",
          description: "Kotikit-owned Figma section name containing the applied node.",
        },
        figmaNodeId: {
          type: "string",
          description: "Figma node ID created or updated by this step.",
        },
        figmaNodeKind: {
          type: "string",
          enum: ["page", "frame", "instance", "node"],
          description: "Kind of Figma node created or updated by this step.",
        },
        figmaNodeName: {
          type: "string",
          description: "Figma node name created or updated by this step.",
        },
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
        figmaPageUrl,
        figmaSectionId,
        figmaSectionName,
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
        figmaPageUrl?: string;
        figmaSectionId?: string;
        figmaSectionName?: string;
        figmaNodeId?: string;
        figmaNodeKind?: DesignNodeKind;
        figmaNodeName?: string;
      };

      const path = designApplyLogPath(root, scope, screen ?? null);
      await mkdir(dirname(path), { recursive: true });
      const ts = nowIso();
      const shouldUpdateNodeMap = figmaNodeId && stepKind && figmaNodeKind;
      const target = shouldUpdateNodeMap
        ? await readFigmaDraftTarget(root, scope, screen ?? null)
        : null;

      if (shouldUpdateNodeMap && target === null) {
        throw new KotikitError(
          "This applied Figma node cannot be recorded because no draft target is bound.",
          "Bind the Figma draft page with kotikit_figma_target_bind, regenerate the design plan, then apply again."
        );
      }
      if (target !== null && figmaFileKey !== target.fileKey) {
        throw new KotikitError(
          "This applied Figma node belongs to a different Figma file than the bound draft target.",
          "Open the bound draft file and run the kotikit plugin there before applying the design."
        );
      }
      if (target !== null && figmaPageId !== target.pageId) {
        throw new KotikitError(
          "This applied Figma node is outside the bound draft page.",
          "Open the exact bound draft page before applying the design."
        );
      }
      if (target !== null && figmaPageName !== undefined && !isDraftPageName(figmaPageName)) {
        throw new KotikitError(
          "The bound Figma page no longer looks like a draft page.",
          "Rename the page so it contains Draft or Drafts before applying the design."
        );
      }
      if (
        target?.section?.name !== undefined &&
        (figmaSectionId === undefined || figmaSectionName === undefined)
      ) {
        throw new KotikitError(
          "This applied Figma node is missing kotikit Section metadata.",
          "Apply the design with the updated kotikit plugin so generated nodes stay inside the draft Section."
        );
      }
      if (
        target?.section?.name !== undefined &&
        figmaSectionName !== undefined &&
        figmaSectionName !== target.section.name
      ) {
        throw new KotikitError(
          "This applied Figma node is outside the kotikit-owned draft section.",
          "Apply the design inside the Section recorded in the design plan."
        );
      }

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
        ...(figmaPageUrl !== undefined ? { figmaPageUrl } : {}),
        ...(figmaSectionId !== undefined ? { figmaSectionId } : {}),
        ...(figmaSectionName !== undefined ? { figmaSectionName } : {}),
        ...(figmaNodeId !== undefined ? { figmaNodeId } : {}),
        ...(figmaNodeKind !== undefined ? { figmaNodeKind } : {}),
        ...(figmaNodeName !== undefined ? { figmaNodeName } : {}),
      });
      await appendFile(path, line + "\n", "utf-8");

      if (shouldUpdateNodeMap && target !== null) {
        await upsertDesignNodeMapEntry(root, scope, screen ?? null, {
          updatedAt: ts,
          ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
          target,
          ...(figmaPageId && figmaPageName
            ? { page: { id: figmaPageId, name: figmaPageName } }
            : {}),
          ...(figmaSectionId && figmaSectionName
            ? { section: { id: figmaSectionId, name: figmaSectionName } }
            : {}),
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

      return toolText(`Recorded apply: step ${stepIndex} ${outcome}.`, { line });
    } catch (err) {
      return toolError(err);
    }
  });
}
