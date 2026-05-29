import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { mkdir, appendFile } from "fs/promises";
import { dirname } from "path";
import { designApplyLogPath } from "../../util/paths.js";
import { nowIso } from "../../util/ids.js";
import { toolText, toolError } from "../../util/result.js";

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
      },
      required: ["scope", "stepIndex", "outcome"],
    },
  });

  registry.handlers.set("kotikit_design_apply_step", async (args) => {
    try {
      const { root } = ctx;
      const { scope, screen, stepIndex, outcome, note } = args as {
        scope: string;
        screen?: string;
        stepIndex: number;
        outcome: "ok" | "warned" | "failed";
        note?: string;
      };

      const path = designApplyLogPath(root, scope, screen ?? null);
      await mkdir(dirname(path), { recursive: true });

      const line = JSON.stringify({
        ts: nowIso(),
        stepIndex,
        outcome,
        ...(note !== undefined ? { note } : {}),
      });
      await appendFile(path, line + "\n", "utf-8");

      return toolText(
        `Recorded apply: step ${stepIndex} ${outcome}.`,
        { line }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
