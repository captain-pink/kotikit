import { afterEach, describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import type { FigmaComment, FigmaNode } from "../../sync/figma-types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerDesignReviewTools } from "./design-review.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-design-review-tools-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (root: string, config: Awaited<ReturnType<typeof defaultConfig>>): ToolContext => ({
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

const node = (document: NonNullable<FigmaNode["document"]>): FigmaNode => ({ document });

const figmaComment = (id: string): FigmaComment => ({
  id,
  file_key: "fig-file",
  message: "Review comment",
});

describe("design review MCP tools", () => {
  it("starts a bounded Figma design review session from an exact URL", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    const registry = makeRegistry();
    registerDesignReviewTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getNodes: async () => ({
          "12:34": node({
            id: "12:34",
            name: "Members",
            type: "FRAME",
            children: [
              { id: "1:1", name: "Header", type: "FRAME" },
              { id: "1:2", name: "Table", type: "FRAME" },
              { id: "1:3", name: "Mobile cards", type: "FRAME" },
            ],
          }),
        }),
        getImageUrls: async () => ({ "12:34": "https://figma-images.example/members.png" }),
      }),
    });

    const result = await callTool(registry, "kotikit_design_review_start", {
      figmaUrl: "https://www.figma.com/design/fig-file/Test?node-id=12-34",
      surfaceType: "dashboard",
      strictness: "standard",
      maxRegions: 2,
    });
    const detail = detailFrom(result) as {
      sessionId: string;
      target: { targetName: string };
      evidence: { tokenBudget: { returnedRegions: number; truncatedRegions: number } };
    };

    expect(result.isError).toBeFalsy();
    expect(detail.sessionId).toBeString();
    expect(detail.target.targetName).toBe("Members");
    expect(detail.evidence.tokenBudget.returnedRegions).toBe(2);
    expect(detail.evidence.tokenBudget.truncatedRegions).toBe(1);
  });

  it("records findings and returns a compact audit report", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    const registry = makeRegistry();
    registerDesignReviewTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getNodes: async () => ({
          "12:34": node({ id: "12:34", name: "Members", type: "FRAME" }),
        }),
      }),
    });

    const start = await callTool(registry, "kotikit_design_review_start", {
      figmaUrl: "https://www.figma.com/design/fig-file/Test?node-id=12-34",
    });
    const sessionId = (detailFrom(start) as { sessionId: string }).sessionId;
    const recorded = await callTool(registry, "kotikit_design_review_record", {
      sessionId,
      findings: [
        {
          category: "layout",
          severity: "high",
          confidence: "observed",
          title: "Actions are misaligned",
          observation: "Switches and action buttons are not on the same row center.",
          rationale: "Repeated controls should scan as a stable column.",
          recommendation: "Align row controls to the same vertical center.",
          nodeId: "12:34",
          commentable: true,
          suggestedComment: "Align the row controls to the same vertical center.",
        },
      ],
    });
    const report = await callTool(registry, "kotikit_design_review_get", { sessionId });

    expect((detailFrom(recorded) as { findings: unknown[] }).findings).toHaveLength(1);
    expect((detailFrom(report) as { summary: { high: number } }).summary.high).toBe(1);
  });

  it("prepares and posts approved Figma comments for recorded findings", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    let postedMeta: unknown;
    const registry = makeRegistry();
    registerDesignReviewTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getNodes: async () => ({
          "12:34": node({ id: "12:34", name: "Members", type: "FRAME" }),
        }),
        postComment: async (_fileKey, input) => {
          postedMeta = input.clientMeta;
          return figmaComment("posted-1");
        },
      }),
    });

    const start = await callTool(registry, "kotikit_design_review_start", {
      figmaUrl: "https://www.figma.com/design/fig-file/Test?node-id=12-34",
    });
    const sessionId = (detailFrom(start) as { sessionId: string }).sessionId;
    const recorded = await callTool(registry, "kotikit_design_review_record", {
      sessionId,
      findings: [
        {
          category: "typography",
          severity: "medium",
          confidence: "observed",
          title: "Text contrast is weak",
          observation: "The secondary text is too faint.",
          rationale: "Low contrast makes the table harder to scan.",
          recommendation: "Use the design-system secondary text color with accessible contrast.",
          region: { x: 10, y: 20, width: 120, height: 40 },
          commentable: true,
          suggestedComment: "Increase contrast for this secondary text.",
        },
      ],
    });
    const findingId = (detailFrom(recorded) as { findings: { findingId: string }[] }).findings[0]!
      .findingId;
    const prepared = await callTool(registry, "kotikit_design_review_comment_prepare", {
      sessionId,
      findingIds: [findingId],
    });
    const posted = await callTool(registry, "kotikit_design_review_comment_post", {
      sessionId,
      confirm: true,
    });

    expect((detailFrom(prepared) as { comments: unknown[] }).comments).toHaveLength(1);
    expect((detailFrom(posted) as { posted: unknown[] }).posted).toHaveLength(1);
    expect(postedMeta).toEqual({
      x: 10,
      y: 20,
      region_width: 120,
      region_height: 40,
      comment_pin_corner: "bottom-right",
    });
  });

  it("refuses to post review comments without explicit confirmation", async () => {
    const root = mkTmp();
    const cfg = defaultConfig();
    cfg.figma.token = "plain-token";
    await writeConfig(root, cfg);
    const registry = makeRegistry();
    registerDesignReviewTools(registry, makeCtx(root, cfg), {
      figmaClientFactory: () => ({
        getNodes: async () => ({
          "12:34": node({ id: "12:34", name: "Members", type: "FRAME" }),
        }),
        postComment: async () => figmaComment("posted-1"),
      }),
    });

    const result = await callTool(registry, "kotikit_design_review_comment_post", {
      sessionId: "missing",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("confirm");
  });
});
