import { describe, expect, it } from "bun:test";
import { buildDashboardModel, detailFromToolResult, type ToolResult } from "../view-model.js";

const result = (detail: unknown, isError = false): ToolResult => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text", text: `ok\n\n${JSON.stringify(detail)}` }],
});

describe("plugin dashboard view model", () => {
  it("parses the JSON detail payload from MCP tool text", () => {
    expect(detailFromToolResult<{ ok: boolean }>(result({ ok: true }))?.ok).toBe(true);
    expect(detailFromToolResult({ content: [{ type: "text", text: "plain text" }] })).toBeNull();
  });

  it("builds checklist rows from tool availability, doctor, and review report", () => {
    const model = buildDashboardModel({
      connected: true,
      tools: ["kotikit_doctor", "kotikit_design_review_report"],
      doctor: result({ ok: true, checks: [] }),
      reviewReport: result({
        summary: {
          open: 2,
          fixed: 1,
          pendingReplies: 1,
          needsDecision: 0,
          unmapped: 0,
        },
      }),
    });

    expect(model.statusText).toBe("Connected");
    expect(model.checklist.map((item) => item.status)).toEqual(["done", "done", "attention"]);
    expect(model.reviewSummary).toEqual({
      open: 2,
      fixed: 1,
      pendingReplies: 1,
      needsDecision: 0,
      unmapped: 0,
    });
  });

  it("marks doctor and review rows as pending before data is loaded", () => {
    const model = buildDashboardModel({
      connected: false,
      tools: [],
      doctor: null,
      reviewReport: null,
    });

    expect(model.statusText).toBe("Disconnected");
    expect(model.checklist.map((item) => item.status)).toEqual(["pending", "pending", "pending"]);
  });
});
