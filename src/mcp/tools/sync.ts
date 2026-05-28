import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { syncAllFiles } from "../../sync/multi-file.js";
import { resolveSecret } from "../../config/load.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";
import { hasCheckpoint } from "../../sync/checkpoint.js";

export interface RegisterSyncToolsOpts {
  /** For tests. If omitted, the real FigmaClient is constructed. */
  figmaClientFactory?: (token: string) => FigmaClient;
}

export function registerSyncTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterSyncToolsOpts = {}
): void {
  const tool: Tool = {
    name: "kotikit_sync_ds",
    description:
      "Pull the latest design system from Figma into the local search index.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_sync_ds", async (_args) => {
    try {
      // 1. Load config — must be initialized
      const config = await ctx.loadConfig();
      if (config === null) {
        return toolError(
          new KotikitError(
            "Kotikit isn't set up in this project yet.",
            "Use config_init to get started."
          )
        );
      }

      // 2. Resolve the Figma token
      const token = await resolveSecret(config.figma.token);
      if (token === undefined || token === "") {
        return toolError(
          new KotikitError(
            "I couldn't find your Figma token.",
            "Set FIGMA_TOKEN in .env or use the op:// reference in config."
          )
        );
      }

      // 3. Ensure at least one file is configured
      if (config.figma.designSystemFiles.length === 0) {
        return toolError(
          new KotikitError(
            "There are no Figma files configured yet.",
            "Add one in the init conversation, or edit .kotikit/config.json."
          )
        );
      }

      // 4. Build the Figma client (real or injected)
      const client = opts.figmaClientFactory
        ? opts.figmaClientFactory(token)
        : new FigmaClient({ token });

      // 5. Run the sync
      const report = await syncAllFiles({
        root: ctx.root,
        files: config.figma.designSystemFiles,
        client,
      });

      // 6. Build a human-readable summary
      const totalComponents = report.files.reduce(
        (sum, f) => sum + f.componentCount,
        0
      );
      const totalIcons = report.files.reduce(
        (sum, f) => sum + f.iconCount,
        0
      );
      const conflictCount = report.conflicts.length;
      const summary =
        `Synced ${report.files.length} file(s). ` +
        `${totalComponents} components, ${totalIcons} icons. ` +
        `${conflictCount} name conflict(s).`;

      return toolText(summary, report);
    } catch (err) {
      // Attempt to detect a lingering checkpoint for resume hint
      let hint: string | undefined;
      try {
        if (await hasCheckpoint(ctx.root)) {
          hint = "Run sync again and it will resume from where it stopped.";
        }
      } catch {
        // ignore errors from hasCheckpoint itself
      }

      if (err instanceof KotikitError) {
        // Append resume hint to the existing hint, if any
        const combinedHint = [err.hint, hint].filter(Boolean).join(" ");
        return toolError(
          new KotikitError(err.userMessage, combinedHint || undefined)
        );
      }

      // Unknown error — wrap with the resume hint if present
      if (hint) {
        return toolError(
          new KotikitError(
            "Something went wrong during the sync.",
            hint
          )
        );
      }

      return toolError(err);
    }
  });
}
