import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";

const BridgeStartArgsSchema = z.object({
  preferredPort: z.number().int().min(1024).max(65535).optional(),
});

const unavailableBridgeError = (): KotikitError =>
  new KotikitError(
    "Bridge control is not available in this kotikit session.",
    "Restart your assistant after updating kotikit, then ask it to start the Figma plugin bridge again."
  );

const bridgeStartTool: Tool = {
  name: "kotikit_bridge_start",
  description:
    "Start the local Figma plugin WebSocket bridge and return the pasteable plugin URL.",
  inputSchema: {
    type: "object",
    properties: {
      preferredPort: {
        type: "number",
        description: "Optional preferred localhost port. Defaults to 53124 and falls forward if busy.",
      },
    },
  },
};

const bridgeStopTool: Tool = {
  name: "kotikit_bridge_stop",
  description:
    "Stop the local Figma plugin WebSocket bridge owned by this kotikit MCP process and clear bridge config.",
  inputSchema: { type: "object", properties: {} },
};

const bridgeStatusTool: Tool = {
  name: "kotikit_bridge_status",
  description:
    "Report whether the local Figma plugin bridge is running in this kotikit MCP process.",
  inputSchema: { type: "object", properties: {} },
};

export function registerBridgeTools(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push(bridgeStartTool, bridgeStopTool, bridgeStatusTool);

  registry.handlers.set("kotikit_bridge_start", async (args) => {
    try {
      if (ctx.bridge === undefined) return toolError(unavailableBridgeError());
      const parsed = BridgeStartArgsSchema.parse(args);
      const status = await ctx.bridge.start(parsed);
      const summary =
        `Figma plugin bridge is running. Paste this URL into the kotikit Figma plugin: ${status.url}`;
      return toolText(summary, status);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return toolError(
          new KotikitError(
            "The bridge port must be a number between 1024 and 65535.",
            "Try again without a port, or choose another localhost port."
          )
        );
      }
      return toolError(err);
    }
  });

  registry.handlers.set("kotikit_bridge_stop", async () => {
    if (ctx.bridge === undefined) return toolError(unavailableBridgeError());
    const result = await ctx.bridge.stop();
    if (result.stopped) {
      return toolText("Figma plugin bridge stopped.", result);
    }
    if (result.clearedConfig) {
      return toolText("No running bridge was owned by this session, but stale bridge config was cleared.", result);
    }
    return toolText("No Figma plugin bridge is running in this kotikit session.", result);
  });

  registry.handlers.set("kotikit_bridge_status", async () => {
    if (ctx.bridge === undefined) return toolError(unavailableBridgeError());
    const status = await ctx.bridge.status();
    if (status.running) {
      return toolText(`Figma plugin bridge is running at ${status.url}.`, status);
    }
    if (status.staleConfig) {
      return toolText(
        "No bridge owned by this session is running, but stale bridge config exists. Start the bridge again to replace it, or stop it to clear the stale config.",
        status
      );
    }
    return toolText("No Figma plugin bridge is running in this kotikit session.", status);
  });
}
