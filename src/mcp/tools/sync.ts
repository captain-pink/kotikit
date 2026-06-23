import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { hasCheckpoint } from "../../sync/checkpoint.js";
import { SyncPausedError } from "../../sync/errors.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import { syncAllFiles } from "../../sync/multi-file.js";
import type { ProgressEmitter } from "../../sync/progress.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

const SYNC_SOFT_DEADLINE_MS = 45_000;

export interface RegisterSyncToolsOpts {
  /** For tests. If omitted, the real FigmaClient is constructed. */
  figmaClientFactory?: (token: string) => FigmaClient;
  /** For tests. If omitted, defaults to stderrProgressEmitter inside syncAllFiles. */
  progress?: ProgressEmitter;
  /** For tests. Production uses a 45s soft deadline below MCP's 60s timeout. */
  softDeadlineMs?: number;
}

export function registerSyncTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterSyncToolsOpts = {}
): void {
  const tool: Tool = {
    name: "kotikit_sync_ds",
    description: "Pull the latest design system from Figma into the local search index.",
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

      // 2. Resolve the Figma token. Project .env is the default source unless
      //    config.figma.token explicitly points somewhere else.
      const token = await resolveFigmaToken(ctx.root, config);
      if (token === undefined || token === "") {
        return toolError(
          new KotikitError(
            "I couldn't find your Figma token.",
            "Create a .env file in your project root (next to package.json) with FIGMA_TOKEN=figd_... and try again. Or set the token directly in .kotikit/config.json under figma.token."
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
        softDeadlineMs: opts.softDeadlineMs ?? SYNC_SOFT_DEADLINE_MS,
        ...(opts.progress !== undefined ? { progress: opts.progress } : {}),
      });

      // 6. Build a human-readable summary
      const totalComponents = report.files.reduce((sum, f) => sum + f.componentCount, 0);
      const totalIcons = report.files.reduce((sum, f) => sum + f.iconCount, 0);
      const conflictCount = report.conflicts.length;
      let summary =
        `Synced ${report.files.length} file(s). ` +
        `${totalComponents} components, ${totalIcons} icons. ` +
        `${conflictCount} name conflict(s).`;

      const emptyFiles = report.files.filter(
        (file) => file.componentCount === 0 && file.iconCount === 0
      );
      if (emptyFiles.length > 0) {
        const names = emptyFiles.map((file) => `"${file.name}"`).join(", ");
        const emptySummary =
          `Sync finished, but ${names} returned 0 components and 0 icons. ` +
          `If the file is a published library, this usually means the sync was interrupted - run sync again. ` +
          `If it persists, verify the token has access to the published library.`;
        return { ...toolText(emptySummary, report), isError: true as const };
      }

      // If any file skipped the variables stage (Enterprise-gated 403), surface
      // a clear explanation so free-plan users are not confused by a silent skip.
      const variablesSkipped = report.skipped?.some((s) => s.stage === "variables") ?? false;
      if (variablesSkipped) {
        summary +=
          ` Note: Figma Variables REST API requires an Enterprise plan - color/text/effect styles were still synced normally.` +
          ` To import variables on Professional, ask your assistant to start the kotikit bridge, open the design-system file in Figma, run the kotikit plugin, and click "Sync Variables From Open File".`;
      }

      return toolText(summary, report);
    } catch (err) {
      if (err instanceof SyncPausedError) {
        return toolText(
          `Sync paused to avoid timeout - progress saved. ` +
            `Run sync again and it will resume from where it stopped. ` +
            `(${err.filesCompleted}/${err.totalFiles} file(s) fully done, paused during ${err.lastStage})`,
          {
            paused: true,
            filesCompleted: err.filesCompleted,
            totalFiles: err.totalFiles,
            lastStage: err.lastStage,
          }
        );
      }

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
        return toolError(new KotikitError(err.userMessage, combinedHint || undefined));
      }

      // Unknown error — wrap with the resume hint if present
      if (hint) {
        return toolError(new KotikitError("Something went wrong during the sync.", hint));
      }

      return toolError(err);
    }
  });
}
