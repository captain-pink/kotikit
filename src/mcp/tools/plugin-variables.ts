import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { importPluginVariables, PluginVariablesPayloadSchema } from "../../sync/plugin-variables.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";

const PluginVariablesToolArgsSchema = z.object({
  payload: PluginVariablesPayloadSchema,
});

export function registerPluginVariableTools(
  registry: ToolRegistry,
  ctx: ToolContext
): void {
  const tool: Tool = {
    name: "kotikit_sync_plugin_variables",
    description:
      "Import Figma variables exported by the kotikit Figma plugin into design-system/variables.json.",
    inputSchema: {
      type: "object",
      properties: {
        payload: {
          type: "object",
          description: "Compact variable payload exported from the open Figma file by the kotikit plugin.",
        },
      },
      required: ["payload"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_sync_plugin_variables", async (args) => {
    try {
      const config = await ctx.loadConfig();
      if (config === null) {
        return toolError(
          new KotikitError(
            "Kotikit isn't set up in this project yet.",
            "Run kotikit init first, then open the design-system file in Figma and run the plugin variable sync."
          )
        );
      }

      const parsed = PluginVariablesToolArgsSchema.parse(args);
      const result = await importPluginVariables(ctx.root, parsed.payload);
      const summary =
        `Imported ${result.imported} Figma variable${result.imported === 1 ? "" : "s"} ` +
        `into design-system/variables.json.`;

      return toolText(summary, result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return toolError(
          new KotikitError(
            "The Figma plugin sent variable data in a shape kotikit could not read.",
            "Update the kotikit plugin build, then run variable sync again from the open design-system file."
          )
        );
      }
      return toolError(err);
    }
  });
}
