import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { upsertDesignNodeMapEntry } from "../../planning/design-node-map.js";
import type { FigmaComment } from "../../sync/figma-types.js";
import { registerDesignCommentTools } from "./design-comments.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-comments-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (root: string, config: Awaited<ReturnType<typeof defaultConfig>> | null): ToolContext => ({
  root,
  loadConfig: async () => config,
});

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return handler(args);
};

const detailFrom = (result: { content: { text: string }[] }): unknown => {
  const text = result.content[0]?.text ?? "";
  const jsonStart = text.indexOf("\n\n");
  return JSON.parse(text.slice(jsonStart + 2));
};

const comment = (overrides: Partial<FigmaComment>): FigmaComment => ({
  id: "comment-1",
  file_key: "fig-file",
  message: "Use the primary action",
  created_at: "2026-06-17T00:00:00Z",
  user: { id: "user-1", handle: "Reviewer" },
  ...overrides,
});

describe("kotikit_design_review_comments", () => {
  it("maps Figma comments onto the persisted design node map", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    await upsertDesignNodeMapEntry(root, "members", "list", {
      updatedAt: "2026-06-17T00:00:00.000Z",
      figmaFileKey: "fig-file",
      page: { id: "page-1", name: "Members" },
      entry: {
        stepIndex: 3,
        stepKind: "place-component",
        outcome: "ok",
        state: "default",
        componentName: "Button",
        dsKey: "button-key",
        nodeId: "node-1",
        nodeKind: "instance",
        nodeName: "Invite member",
      },
    });

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getComments: async () => [comment({ client_meta: { node_id: "node-1" } })],
      }),
    });

    const result = await callTool(registry, "kotikit_design_review_comments", {
      scope: "members",
      screen: "list",
    });
    const detail = detailFrom(result) as { mapped: { target: { componentName: string } }[] };

    expect(result.isError).toBeFalsy();
    expect(detail.mapped[0]?.target.componentName).toBe("Button");
  });

  it("can fetch comments for a file key without a local node map", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getComments: async () => [comment({ client_meta: { node_id: "outside-node" } })],
      }),
    });

    const result = await callTool(registry, "kotikit_design_review_comments", {
      fileKey: "fig-file",
    });
    const detail = detailFrom(result) as { unmapped: { nodeId?: string }[] };

    expect(result.isError).toBeFalsy();
    expect(detail.unmapped[0]?.nodeId).toBe("outside-node");
  });

  it("loads FIGMA_TOKEN from project .env", async () => {
    const previousToken = process.env.FIGMA_TOKEN;
    delete process.env.FIGMA_TOKEN;

    try {
      const root = mkTmp();
      const cfg = defaultConfig();
      await writeConfig(root, cfg);
      writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_from_comments_env\n");
      let capturedToken: string | undefined;

      const registry = makeRegistry();
      registerDesignCommentTools(registry, makeCtx(root, cfg), {
        figmaClientFactory: (token) => {
          capturedToken = token;
          return { getComments: async () => [] };
        },
      });

      await callTool(registry, "kotikit_design_review_comments", { fileKey: "fig-file" });

      expect(capturedToken).toBe("figd_from_comments_env");
    } finally {
      if (previousToken === undefined) {
        delete process.env.FIGMA_TOKEN;
      } else {
        process.env.FIGMA_TOKEN = previousToken;
      }
    }
  });

  it("returns a friendly error when no token can be resolved", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({ getComments: async () => [] }),
    });

    const result = await callTool(registry, "kotikit_design_review_comments", {
      fileKey: "fig-file",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Figma token");
  });

  it("returns a friendly error when neither fileKey nor node map can identify a file", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({ getComments: async () => [] }),
    });

    const result = await callTool(registry, "kotikit_design_review_comments", {
      scope: "members",
      screen: "list",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("fileKey");
  });
});
