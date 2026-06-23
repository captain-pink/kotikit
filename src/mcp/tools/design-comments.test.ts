import { afterEach, describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { upsertDesignNodeMapEntry } from "../../planning/design-node-map.js";
import type { FigmaComment } from "../../sync/figma-types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
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

const makeCtx = (
  root: string,
  config: Awaited<ReturnType<typeof defaultConfig>> | null
): ToolContext => ({
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
    const detail = detailFrom(result) as {
      sessionId: string;
      mapped: { target: { componentName: string } }[];
    };

    expect(result.isError).toBeFalsy();
    expect(detail.sessionId).toBeString();
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

  it("records adjustments, reports the review pass, and surfaces memory candidates", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getComments: async () => [comment({ client_meta: { node_id: "node-1" } })],
        postComment: async () => comment({ id: "reply-1", parent_id: "comment-1" }),
      }),
    });

    const review = await callTool(registry, "kotikit_design_review_comments", {
      fileKey: "fig-file",
      scope: "members",
    });
    const reviewDetail = detailFrom(review) as { sessionId: string };

    const adjustment = await callTool(registry, "kotikit_design_adjustment_record", {
      sessionId: reviewDetail.sessionId,
      scope: "members",
      fileKey: "fig-file",
      commentId: "comment-1",
      nodeId: "node-1",
      category: "density",
      summary: "Reduced row height and cell padding.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });
    const report = await callTool(registry, "kotikit_design_review_report", {
      sessionId: reviewDetail.sessionId,
    });
    const candidates = await callTool(registry, "kotikit_design_memory_candidates", {});

    expect(adjustment.isError).toBeFalsy();
    expect((detailFrom(report) as { summary: { fixed: number } }).summary.fixed).toBe(1);
    expect((detailFrom(candidates) as { candidates: { key: string }[] }).candidates[0]?.key).toBe(
      "tables.density.compact_rows"
    );
  });

  it("clusters repeated adjustments into candidates without explicit preference keys", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({ getComments: async () => [] }),
    });

    await callTool(registry, "kotikit_design_adjustment_record", {
      scope: "members",
      screen: "list",
      category: "density",
      summary: "Reduced row height and cell padding.",
    });
    await callTool(registry, "kotikit_design_adjustment_record", {
      scope: "teams",
      screen: "list",
      category: "density",
      summary: "Reduced row height and cell padding.",
    });

    const candidates = await callTool(registry, "kotikit_design_memory_candidates", {});
    const first = (
      detailFrom(candidates) as {
        candidates: { key: string; evidenceCount: number; distinctScreens: number }[];
      }
    ).candidates[0];

    expect(first?.key).toBe("density.row_height_cell_padding");
    expect(first?.evidenceCount).toBe(2);
    expect(first?.distinctScreens).toBe(2);
  });

  it("dismisses candidates and updates or deactivates promoted preferences", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({ getComments: async () => [] }),
    });

    await callTool(registry, "kotikit_design_adjustment_record", {
      scope: "members",
      category: "spacing",
      summary: "Increased section spacing.",
      preferenceKey: "layout.spacing.roomy_sections",
      preferenceSummary: "Prefer roomy spacing between admin page sections.",
    });
    const dismissed = await callTool(registry, "kotikit_design_memory_dismiss", {
      candidateKey: "layout.spacing.roomy_sections",
    });
    const dismissedCandidates = await callTool(registry, "kotikit_design_memory_candidates", {
      status: "dismissed",
    });

    expect((detailFrom(dismissed) as { candidate: { status: string } }).candidate.status).toBe(
      "dismissed"
    );
    expect(
      (detailFrom(dismissedCandidates) as { candidates: { key: string }[] }).candidates[0]?.key
    ).toBe("layout.spacing.roomy_sections");

    await callTool(registry, "kotikit_design_adjustment_record", {
      scope: "members",
      category: "density",
      summary: "Reduced row height.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });
    await callTool(registry, "kotikit_design_memory_promote", {
      candidateKey: "tables.density.compact_rows",
      scope: "members",
    });
    const updated = await callTool(registry, "kotikit_design_memory_update", {
      preferenceKey: "tables.density.compact_rows",
      rule: "Use compact rows only for dense admin data tables.",
      status: "inactive",
    });
    const search = await callTool(registry, "kotikit_design_memory_search", {
      scope: "members",
      query: "compact",
    });

    expect(
      (detailFrom(updated) as { preference: { rule: string; status: string } }).preference.rule
    ).toContain("dense admin data tables");
    expect((detailFrom(updated) as { preference: { status: string } }).preference.status).toBe(
      "inactive"
    );
    expect((detailFrom(search) as { preferences: unknown[] }).preferences).toHaveLength(0);
  });

  it("prepares and posts Figma replies for fixed comments", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    let postedCommentId: string | undefined;

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getComments: async () => [comment({ client_meta: { node_id: "node-1" } })],
        postComment: async (_fileKey, input) => {
          postedCommentId = input.commentId;
          return comment({ id: "reply-1", parent_id: input.commentId });
        },
      }),
    });

    const review = await callTool(registry, "kotikit_design_review_comments", {
      fileKey: "fig-file",
      scope: "members",
    });
    const sessionId = (detailFrom(review) as { sessionId: string }).sessionId;
    await callTool(registry, "kotikit_design_adjustment_record", {
      sessionId,
      scope: "members",
      fileKey: "fig-file",
      commentId: "comment-1",
      category: "spacing",
      summary: "Adjusted spacing.",
    });

    const prepared = await callTool(registry, "kotikit_design_comment_reply_prepare", {
      sessionId,
      message: "Fixed in this pass.",
    });
    const posted = await callTool(registry, "kotikit_design_comment_reply_post", {
      sessionId,
    });

    expect((detailFrom(prepared) as { replies: unknown[] }).replies).toHaveLength(1);
    expect((detailFrom(posted) as { posted: unknown[] }).posted).toHaveLength(1);
    expect(postedCommentId).toBe("comment-1");
  });

  it("promotes and searches active design preferences", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    registerDesignCommentTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getComments: async () => [comment({})],
        postComment: async () => comment({ id: "reply-1" }),
      }),
    });

    const review = await callTool(registry, "kotikit_design_review_comments", {
      fileKey: "fig-file",
      scope: "members",
    });
    const sessionId = (detailFrom(review) as { sessionId: string }).sessionId;
    await callTool(registry, "kotikit_design_adjustment_record", {
      sessionId,
      scope: "members",
      fileKey: "fig-file",
      category: "density",
      summary: "Reduced row height.",
      preferenceKey: "tables.density.compact_rows",
      preferenceSummary: "Use compact rows for admin tables.",
    });

    const promoted = await callTool(registry, "kotikit_design_memory_promote", {
      candidateKey: "tables.density.compact_rows",
      scope: "members",
      rule: "For member-management tables, prefer compact row density.",
    });
    const search = await callTool(registry, "kotikit_design_memory_search", {
      scope: "members",
      query: "compact",
    });

    expect((detailFrom(promoted) as { preference: { status: string } }).preference.status).toBe(
      "active"
    );
    expect((detailFrom(search) as { preferences: { key: string }[] }).preferences[0]?.key).toBe(
      "tables.density.compact_rows"
    );
  });
});
