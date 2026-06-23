import { describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { BRAINSTORM_SYSTEM_PROMPT, registerBrainstormTools } from "../brainstorm.js";

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

function makeRegistry(): ToolRegistry {
  return {
    tools: [] as Tool[],
    handlers: new Map(),
  };
}

function makeCtx(): ToolContext {
  return { root: "/tmp/test-kotikit", loadConfig: async () => null };
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
