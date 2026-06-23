import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { BRAINSTORM_SYSTEM_PROMPT, registerBrainstormTools } from "../brainstorm.js";

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

let tmp: string;

function makeRegistry(): ToolRegistry {
  return {
    tools: [] as Tool[],
    handlers: new Map(),
  };
}

function makeCtx(): ToolContext {
  return { root: tmp, loadConfig: async () => null };
}

function setup() {
  const registry = makeRegistry();
  const ctx = makeCtx();
  registerBrainstormTools(registry, ctx);
  return registry;
}

async function callTool(
  registry: ToolRegistry,
  name: string,
  args: unknown
): Promise<{ text: string; isError?: boolean }> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`Handler not found: ${name}`);
  const result = await handler(args);
  const text = result.content.map((c: { type: "text"; text: string }) => c.text).join("\n");
  return { text, isError: result.isError };
}

function parseDetail(text: string): unknown {
  // toolText puts summary on first line(s), then blank line, then JSON
  const jsonStart = text.indexOf("\n\n");
  if (jsonStart === -1) return {};
  return JSON.parse(text.slice(jsonStart + 2));
}

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-brainstorm-tools-test-${Date.now()}-${Math.random()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. brainstorm_start — multi-screen classification
// ---------------------------------------------------------------------------

describe("kotikit_brainstorm_start", () => {
  it("classifies a checkout flow idea as multiScreen and includes flowConnectivity", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a checkout flow with cart, shipping, payment",
    });

    const detail = parseDetail(text) as {
      classification: string;
      coverageChecklist: string[];
    };

    expect(detail.classification).toBe("multiScreen");
    expect(detail.coverageChecklist).toContain("flowConnectivity");
  });

  // ---------------------------------------------------------------------------
  // 2. brainstorm_start — single-screen classification
  // ---------------------------------------------------------------------------

  it("classifies a profile page idea as singleScreen and excludes flowConnectivity", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a profile page",
    });

    const detail = parseDetail(text) as {
      classification: string;
      coverageChecklist: string[];
    };

    expect(detail.classification).toBe("singleScreen");
    expect(detail.coverageChecklist).not.toContain("flowConnectivity");
  });

  it("includes all 6 base dimensions for singleScreen", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a dashboard page",
    });
    const detail = parseDetail(text) as { coverageChecklist: string[] };
    const expected = [
      "states",
      "visualEdgeCases",
      "accessibility",
      "interactions",
      "dataContracts",
      "responsive",
    ];
    for (const dim of expected) {
      expect(detail.coverageChecklist).toContain(dim);
    }
    expect(detail.coverageChecklist).toHaveLength(6);
  });

  it("includes all 7 dimensions for multiScreen", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "onboarding wizard",
    });
    const detail = parseDetail(text) as { coverageChecklist: string[] };
    expect(detail.coverageChecklist).toHaveLength(7);
    expect(detail.coverageChecklist).toContain("flowConnectivity");
  });

  it("returns tailored firstQuestions referencing the idea", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a notifications inbox",
    });
    const detail = parseDetail(text) as { firstQuestions: string[] };
    expect(Array.isArray(detail.firstQuestions)).toBe(true);
    expect(detail.firstQuestions.length).toBeGreaterThanOrEqual(2);
    // At least one question should mention the specific idea
    const mentionsIdea = detail.firstQuestions.some(
      (q: string) => q.toLowerCase().includes("notification") || q.toLowerCase().includes("inbox")
    );
    expect(mentionsIdea).toBe(true);
  });

  it("returns the qualityBar string", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a simple page",
    });
    const detail = parseDetail(text) as { qualityBar: string };
    expect(detail.qualityBar).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
  });

  it("returns systemPromptRef === 'brainstorm' instead of inline doctrine", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a simple page",
    });
    const detail = parseDetail(text) as {
      systemPromptRef: string;
      systemPrompt: string;
    };
    expect(detail.systemPromptRef).toBe("brainstorm");
    // systemPrompt should be a stub, not the full doctrine
    expect(detail.systemPrompt).toContain("kotikit_get_system_prompt");
    expect(detail.systemPrompt).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
  });

  it("creates a persisted session and returns one next question", async () => {
    const registry = setup();
    const { text } = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a members admin page",
    });

    const detail = parseDetail(text) as {
      sessionId: string;
      nextQuestion: { dimension: string; text: string };
      openDimensions: string[];
      status: string;
    };

    expect(detail.status).toBe("inProgress");
    expect(detail.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(detail.nextQuestion.dimension).toBe("states");
    expect(detail.nextQuestion.text).toContain("loading");
    expect(detail.openDimensions).toContain("states");
  });
});

// ---------------------------------------------------------------------------
// 3. brainstorm_assess — all covered → readyToSave
// ---------------------------------------------------------------------------

describe("kotikit_brainstorm_assess", () => {
  it("returns readyToSave with a draftTemplate when all single-screen dimensions are covered", async () => {
    const registry = setup();
    const coverage = {
      states: "covered",
      visualEdgeCases: "covered",
      accessibility: "covered",
      interactions: "covered",
      dataContracts: "covered",
      responsive: "covered",
    } as const;

    const { text } = await callTool(registry, "kotikit_brainstorm_assess", {
      scope: "profile-page",
      coverage,
      notes: "Shows user profile info and avatar.",
    });

    const detail = parseDetail(text) as {
      status: string;
      draftTemplate: {
        scope: string;
        screen: { slug: string; description: string };
      };
    };

    expect(detail.status).toBe("readyToSave");
    expect(detail.draftTemplate).toBeDefined();
    expect(detail.draftTemplate.scope).toBe("profile-page");
    expect(detail.draftTemplate.screen).toBeDefined();
    expect(detail.draftTemplate.screen.description).toBe("Shows user profile info and avatar.");
  });

  it("returns readyToSave with a flow draftTemplate when all 7 multi-screen dimensions are covered", async () => {
    const registry = setup();
    const coverage = {
      states: "covered",
      visualEdgeCases: "covered",
      accessibility: "covered",
      interactions: "covered",
      dataContracts: "covered",
      responsive: "covered",
      flowConnectivity: "covered",
    } as const;

    const { text } = await callTool(registry, "kotikit_brainstorm_assess", {
      scope: "checkout-flow",
      coverage,
      notes: "Full purchase flow.",
    });

    const detail = parseDetail(text) as {
      status: string;
      draftTemplate: {
        scope: string;
        title: string;
        screens: unknown[];
        transitions: unknown[];
      };
    };

    expect(detail.status).toBe("readyToSave");
    expect(detail.draftTemplate.scope).toBe("checkout-flow");
    expect(detail.draftTemplate.title).toBeDefined();
    expect(Array.isArray(detail.draftTemplate.screens)).toBe(true);
    expect(Array.isArray(detail.draftTemplate.transitions)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. brainstorm_assess — open dimension → keepGoing
  // ---------------------------------------------------------------------------

  it("returns keepGoing naming the open dimension when one dimension is open", async () => {
    const registry = setup();
    const coverage = {
      states: "covered",
      visualEdgeCases: "open",
      accessibility: "covered",
      interactions: "covered",
      dataContracts: "covered",
      responsive: "covered",
    } as const;

    const { text } = await callTool(registry, "kotikit_brainstorm_assess", {
      scope: "dashboard",
      coverage,
    });

    const detail = parseDetail(text) as {
      status: string;
      openDimensions: string[];
      suggestedQuestions: string[];
    };

    expect(detail.status).toBe("keepGoing");
    expect(detail.openDimensions).toContain("visualEdgeCases");
    expect(Array.isArray(detail.suggestedQuestions)).toBe(true);
    expect(detail.suggestedQuestions.length).toBeGreaterThan(0);
  });

  it("treats missing dimensions as open and returns keepGoing", async () => {
    const registry = setup();
    // Only provide 4 of the 6 required dimensions
    const coverage = {
      states: "covered",
      visualEdgeCases: "covered",
      // accessibility missing — should be treated as open
      interactions: "covered",
      dataContracts: "covered",
      // responsive missing
    } as Record<string, "covered" | "open">;

    const { text } = await callTool(registry, "kotikit_brainstorm_assess", {
      scope: "settings-page",
      coverage,
    });

    const detail = parseDetail(text) as {
      status: string;
      openDimensions: string[];
    };

    expect(detail.status).toBe("keepGoing");
    expect(detail.openDimensions).toContain("accessibility");
    expect(detail.openDimensions).toContain("responsive");
  });

  it("records actual answer evidence before declaring a session ready to confirm", async () => {
    const registry = setup();
    const start = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a members admin page",
    });
    const { sessionId } = parseDetail(start.text) as { sessionId: string };

    const dimensions = [
      "states",
      "visualEdgeCases",
      "accessibility",
      "interactions",
      "dataContracts",
      "responsive",
    ];

    const results: { text: string; isError?: boolean }[] = [];
    for (const dimension of dimensions) {
      results.push(
        await callTool(registry, "kotikit_brainstorm_answer", {
          sessionId,
          dimension,
          answer: `Answer for ${dimension}.`,
        })
      );
    }

    const finalDetail = parseDetail(results.at(-1)?.text ?? "") as {
      status: string;
      openDimensions: string[];
      answeredDimensions: string[];
    };

    expect(finalDetail.status).toBe("readyForConfirmation");
    expect(finalDetail.openDimensions).toEqual([]);
    expect(finalDetail.answeredDimensions).toEqual(dimensions);
  });

  it("refuses to confirm a brainstorm session until all required answers exist", async () => {
    const registry = setup();
    const start = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a members admin page",
    });
    const { sessionId } = parseDetail(start.text) as { sessionId: string };

    const result = await callTool(registry, "kotikit_brainstorm_confirm", {
      sessionId,
      summary: "Looks good.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("still need");
  });

  it("marks a fully answered brainstorm session as completed after designer confirmation", async () => {
    const registry = setup();
    const start = await callTool(registry, "kotikit_brainstorm_start", {
      idea: "a members admin page",
    });
    const { sessionId } = parseDetail(start.text) as { sessionId: string };

    const dimensions = [
      "states",
      "visualEdgeCases",
      "accessibility",
      "interactions",
      "dataContracts",
      "responsive",
    ];

    for (const dimension of dimensions) {
      await callTool(registry, "kotikit_brainstorm_answer", {
        sessionId,
        dimension,
        answer: `Answer for ${dimension}.`,
      });
    }

    const result = await callTool(registry, "kotikit_brainstorm_confirm", {
      sessionId,
      summary: "The designer confirmed the summary.",
    });
    const detail = parseDetail(result.text) as { status: string; sessionId: string };

    expect(result.isError).toBeUndefined();
    expect(detail.status).toBe("completed");
    expect(detail.sessionId).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// 5. BRAINSTORM_SYSTEM_PROMPT contains the quality bar sentence
// ---------------------------------------------------------------------------

describe("BRAINSTORM_SYSTEM_PROMPT", () => {
  it("contains the literal quality bar sentence", () => {
    expect(BRAINSTORM_SYSTEM_PROMPT).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
  });

  it("mentions all required coverage dimensions", () => {
    const dimensions = [
      "states",
      "visualEdgeCases",
      "accessibility",
      "interactions",
      "dataContracts",
      "responsive",
      "flowConnectivity",
    ];
    for (const dim of dimensions) {
      expect(BRAINSTORM_SYSTEM_PROMPT).toContain(dim);
    }
  });
});
