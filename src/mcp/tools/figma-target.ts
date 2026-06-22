import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { FigmaClient } from "../../sync/figma-client.js";
import { resolveFigmaToken } from "../../sync/figma-token.js";
import { resolveFigmaDraftTargetFromUrl } from "../../figma/draft-target-resolver.js";
import { writeFigmaDraftTarget } from "../../figma/draft-target-store.js";
import { autoCommit } from "../../git/auto-commit.js";
import { toolError, toolText, KotikitError } from "../../util/result.js";
import type { FigmaDraftTargetClient } from "../../figma/draft-target-resolver.js";

export interface RegisterFigmaTargetToolsOpts {
  figmaClientFactory?: (token: string) => FigmaDraftTargetClient;
  now?: () => string;
}

export function registerFigmaTargetTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterFigmaTargetToolsOpts = {}
): void {
  registry.tools.push({
    name: "kotikit_figma_target_bind",
    description: "Bind a saved spec or flow to one approved Figma draft page.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope (flow or single-screen folder) slug." },
        screen: { type: "string", description: "Screen slug. Omit for a single-screen spec or flow-level target." },
        pageUrl: { type: "string", description: "Figma draft page URL containing node-id." },
      },
      required: ["scope", "pageUrl"],
    },
  } satisfies Tool);

  registry.handlers.set("kotikit_figma_target_bind", async (args) => {
    try {
      const { scope, screen, pageUrl } = args as {
        scope: string;
        screen?: string;
        pageUrl?: string;
      };
      if (pageUrl === undefined || pageUrl.trim() === "") {
        throw new KotikitError(
          "Please send the Figma draft page link where kotikit should create the design.",
          "The page name must contain Draft or Drafts."
        );
      }

      const config = await ctx.loadConfig();
      if (config === null) {
        throw new KotikitError(
          "Kotikit isn't set up in this project yet.",
          "Use kotikit_config_init before binding a Figma draft page."
        );
      }

      const token = await resolveFigmaToken(ctx.root, config);
      if (token === undefined || token === "") {
        throw new KotikitError(
          "I couldn't find your Figma token.",
          "Create a .env file in your project root with FIGMA_TOKEN=figd_... and try again."
        );
      }

      const client = opts.figmaClientFactory?.(token) ?? new FigmaClient({ token });
      const target = await resolveFigmaDraftTargetFromUrl({
        client,
        pageUrl,
        scope,
        screen: screen ?? null,
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      });
      const paths = await writeFigmaDraftTarget(ctx.root, scope, screen ?? null, target);
      const commit = await autoCommit({
        root: ctx.root,
        scope: `figma target ${scope}`,
        kind: "update",
        files: paths,
        enabled: config.git.autoCommit,
        coAuthor: config.git.coAuthor,
        subjectScope: "spec",
        subjectSuffix: screen ? `/${screen}` : "",
      });

      return toolText(
        `Bound ${scope}${screen ? `/${screen}` : ""} to Figma draft page "${target.pageName}".`,
        { target, paths, commit }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
