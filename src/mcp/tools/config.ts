import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InitAnswers } from "../../config/init.js";
import { buildConfig } from "../../config/init.js";
import { configExists, loadConfig, resolveSecret, writeConfig } from "../../config/load.js";
import { isGitRepo } from "../../git/auto-commit.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";

// ─── Registry shape ───────────────────────────────────────────────────────────

type McpContent = { type: "text"; text: string };
type Handler = (args: unknown) => Promise<{ content: McpContent[]; isError?: boolean }>;

export interface ToolRegistry {
  tools: Tool[];
  handlers: Map<string, Handler>;
}

// ─── Register all config tools ────────────────────────────────────────────────

export function registerConfigTools(registry: ToolRegistry, ctx: ToolContext): void {
  registerConfigStatus(registry, ctx);
  registerConfigInit(registry, ctx);
  registerConfigGet(registry, ctx);
}

// ─── kotikit_config_status ────────────────────────────────────────────────────

function registerConfigStatus(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_config_status",
    description:
      "Check whether kotikit is initialized in this project and surface any configuration gaps.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  });

  registry.handlers.set("kotikit_config_status", async (_args) => {
    try {
      const initialized = await configExists(ctx.root);
      const gitRepo = await isGitRepo(ctx.root);
      const missing: string[] = [];

      if (initialized) {
        const config = await loadConfig(ctx.root);
        if (config !== null && config.figma.designSystemFiles.length === 0) {
          missing.push("no Figma design system connected yet (optional)");
        }
      }

      return toolText("Here's your kotikit setup status.", {
        initialized,
        isGitRepo: gitRepo,
        missing,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_config_init ──────────────────────────────────────────────────────

function registerConfigInit(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_config_init",
    description:
      "Initialize or reinitialize kotikit config. All fields are optional and fall back to sensible defaults.",
    inputSchema: {
      type: "object",
      properties: {
        autoCommit: {
          type: "boolean",
          description: "Whether kotikit should auto-commit spec changes via git.",
        },
        coAuthor: {
          type: "object",
          description: "Co-author identity to include in generated commit bodies.",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name", "email"],
        },
        figmaFiles: {
          type: "array",
          description: "Figma design system files to connect.",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              name: { type: "string" },
            },
            required: ["key", "name"],
          },
        },
      },
    },
  });

  registry.handlers.set("kotikit_config_init", async (args) => {
    try {
      const answers = (args ?? {}) as InitAnswers;
      const config = buildConfig(answers);
      await writeConfig(ctx.root, config);

      const gitRepo = await isGitRepo(ctx.root);
      const notes: string[] = [];
      if (config.git.autoCommit && !gitRepo) {
        notes.push(
          "autoCommit is enabled but this directory is not a git repo — commits will be skipped until you run `git init`."
        );
      }

      return toolText("You're all set! What do you want to build?", {
        configPath: `${ctx.root}/.kotikit/config.json`,
        notes,
      });
    } catch (err) {
      return toolError(err);
    }
  });
}

// ─── kotikit_config_get ───────────────────────────────────────────────────────

function registerConfigGet(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_config_get",
    description: "Read the current kotikit config. Never returns raw secret values.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  });

  registry.handlers.set("kotikit_config_get", async (_args) => {
    try {
      const config = await loadConfig(ctx.root);

      if (config === null) {
        return toolError(
          new KotikitError(
            "Kotikit isn't set up in this project yet. Say the word and I'll set it up.",
            "Run config_init to get started."
          )
        );
      }

      // Build a safe copy — never echo the actual token value
      const resolvedToken = await resolveSecret(config.figma.token);
      const safeConfig = {
        ...config,
        figma: {
          ...config.figma,
          token: resolvedToken !== undefined ? "<resolved from env>" : config.figma.token,
        },
      };

      return toolText("Here is your current kotikit config.", safeConfig);
    } catch (err) {
      return toolError(err);
    }
  });
}
