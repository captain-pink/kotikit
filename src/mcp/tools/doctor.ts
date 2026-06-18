import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { runKotikitDoctor } from "../../doctor/doctor.js";
import { toolError, toolText } from "../../util/result.js";

export function registerDoctorTools(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_doctor",
    description:
      "Check kotikit local setup: config, Figma token, design-system DBs, sync checkpoints, code gates, git, and Figma bridge state.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  };

  registry.tools.push(tool);
  registry.handlers.set("kotikit_doctor", async () => {
    try {
      const report = await runKotikitDoctor(ctx.root);
      return toolText(report.ok ? "Kotikit doctor passed." : "Kotikit doctor found setup issues.", report);
    } catch (err) {
      return toolError(err);
    }
  });
}
