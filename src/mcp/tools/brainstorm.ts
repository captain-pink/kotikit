import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { toolText, toolError } from "../../util/result.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DimensionKey =
  | "states"
  | "visualEdgeCases"
  | "accessibility"
  | "interactions"
  | "dataContracts"
  | "responsive"
  | "flowConnectivity";

type Classification = "multiScreen" | "singleScreen";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const BRAINSTORM_SYSTEM_PROMPT = `You are a meticulous, friendly design lead, not a form. Never ask the designer about JSON, schemas, pixel breakpoints, or git. Ask about the *experience*.

Do NOT stop at 3–5 questions. Keep hunting for ambiguity and pitfalls until you can honestly say: *any developer or designer could build this identically from the spec alone.* That sentence is the bar.

Coverage dimensions you must satisfy before writing a spec:
- states: What happens when the screen loads? What does it look like when empty, loading, errored, filled?
- visualEdgeCases: Long text, no data, too many items, permission denied — what does the designer expect?
- accessibility: If someone is using only a keyboard, what's the path? What should be focused first?
- interactions: What triggers navigation? What are the micro-interactions (hover, focus, animation)?
- dataContracts: What data does the screen need? Where does it come from? What's the shape of failure?
- responsive: How does the layout change from phone to tablet to desktop? (Describe behavior, not pixels.)
- flowConnectivity (multi-screen only): Map the whole flow first — entry points, the order of screens, what carries between them — then drill into each screen.

For single-screen ideas: cover all dimensions except flowConnectivity.
For multi-screen ideas: all dimensions including flowConnectivity.

Example plain-language questions by dimension:
- states: "What should someone see while the page is loading? And what if it takes too long?"
- visualEdgeCases: "What happens if a user has no items yet? Is there an empty state message or illustration?"
- accessibility: "If someone tabs through this page with a keyboard, what's the first thing that gets focus?"
- interactions: "When someone taps the checkout button, does anything animate? Does the page scroll?"
- dataContracts: "Where does the list of products come from? What should happen if that request fails?"
- responsive: "On a phone, does this become a single column? Does the sidebar collapse into a menu?"
- flowConnectivity: "How does a user get to this screen? What can they do when they're done here?"

When done, summarize the screen(s) back to the designer in plain English and ask for confirmation before saving. Never reveal the spec JSON structure to the designer.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MULTI_SCREEN_KEYWORDS = ["flow", "steps", "checkout", "wizard", "onboarding", " then "];
const MULTI_SCREEN_SCREEN_NOUNS = ["cart", "shipping", "payment", "login", "signup", "dashboard", "profile", "settings", "confirmation", "summary", "review", "address", "billing"];

function classify(idea: string): Classification {
  const lower = idea.toLowerCase();

  // Keyword match
  for (const kw of MULTI_SCREEN_KEYWORDS) {
    if (lower.includes(kw)) return "multiScreen";
  }

  // Count comma-separated screen nouns
  const matchedNouns = MULTI_SCREEN_SCREEN_NOUNS.filter((noun) => lower.includes(noun));
  if (matchedNouns.length >= 2) return "multiScreen";

  return "singleScreen";
}

function buildChecklist(classification: Classification): DimensionKey[] {
  const base: DimensionKey[] = [
    "states",
    "visualEdgeCases",
    "accessibility",
    "interactions",
    "dataContracts",
    "responsive",
  ];
  if (classification === "multiScreen") {
    base.push("flowConnectivity");
  }
  return base;
}

function generateFirstQuestions(idea: string, classification: Classification): string[] {
  const trimmed = idea.trim();

  if (classification === "multiScreen") {
    return [
      `Let's map the full flow first — for "${trimmed}", what's the entry point? Where does the user come from before they start?`,
      `Walk me through the screens in order. What does someone do on each step, and what moves them forward?`,
      `What happens if someone drops off partway through — say, they close the browser on the second screen — and comes back later?`,
    ];
  }

  return [
    `For "${trimmed}", what's the very first thing a user should see when they land on this screen?`,
    `What happens if this screen has no data yet — is there an empty state, or does something else appear?`,
    `What's the main action a user takes here, and what happens immediately after they take it?`,
  ];
}

function buildSuggestedQuestions(dimension: DimensionKey): string[] {
  const map: Record<DimensionKey, string[]> = {
    states: [
      "What should someone see while the page is loading?",
      "What does the screen look like when it's completely empty?",
      "What does an error state look like — is there a message, a retry button, or something else?",
    ],
    visualEdgeCases: [
      "What happens if a user has a very long name or a description that overflows?",
      "What if there are zero items — is there an empty state illustration or just text?",
      "What if the list has hundreds of items — does it paginate, scroll, or truncate?",
    ],
    accessibility: [
      "If someone tabs through this screen with only a keyboard, what's the first element that gets focus?",
      "Are there any interactive elements that should have screen-reader labels beyond their visible text?",
      "Is there a skip-navigation link or any landmark regions?",
    ],
    interactions: [
      "When the primary button is tapped, is there any animation or visual feedback before the next screen appears?",
      "Do any elements have hover or focus states beyond the browser default?",
      "Is there anything that animates in on load, or on scroll?",
    ],
    dataContracts: [
      "Where does the data for this screen come from — an API, local state, or something else?",
      "What should happen if the data request fails — is there a retry, or does the screen fall back to something?",
      "Are there any fields that might be missing or null, and how should the UI handle that?",
    ],
    responsive: [
      "On a phone, does this layout collapse to a single column?",
      "Does any navigation (sidebar, tabs) collapse into a menu or bottom bar on mobile?",
      "Are there any elements that are hidden on small screens, or reordered?",
    ],
    flowConnectivity: [
      "How does a user arrive at this screen — what triggers the navigation to it?",
      "What can they do when they're done here — where do they go next?",
      "Is there any state or data that needs to be carried from one screen to the next across the flow?",
    ],
  };
  return map[dimension];
}

function getRequiredDimensions(coverage: Record<string, "covered" | "open">): DimensionKey[] {
  const isMulti = "flowConnectivity" in coverage;
  return buildChecklist(isMulti ? "multiScreen" : "singleScreen");
}

function findOpenDimensions(
  required: DimensionKey[],
  coverage: Record<string, "covered" | "open">
): DimensionKey[] {
  return required.filter((dim) => {
    const status = coverage[dim];
    return status === "open" || status === undefined;
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSingleScreenDraft(scope: string, notes?: string) {
  const screenSlug = slugify(scope);
  return {
    scope,
    screen: {
      slug: screenSlug,
      title: scope
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: notes ?? scope,
      functional: [] as string[],
      states: {
        loading: "",
        empty: "",
        error: "",
        filled: "",
      },
      components: [] as string[],
      acceptanceCriteria: [] as string[],
      userTypes: [] as string[],
      entryPoints: [] as string[],
    },
  };
}

function buildFlowDraft(scope: string, notes?: string) {
  const flowTitle = scope
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    scope,
    title: flowTitle,
    description: notes ?? scope,
    screens: [
      {
        slug: "screen-1",
        title: "Screen 1",
        description: "",
        functional: [] as string[],
        states: {
          loading: "",
          empty: "",
          error: "",
          filled: "",
        },
      },
    ],
    transitions: [
      {
        from: "screen-1",
        to: "screen-2",
        trigger: "",
      },
    ],
    sharedState: [] as string[],
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const brainstormStartTool: Tool = {
  name: "kotikit_brainstorm_start",
  description:
    "Start a brainstorm session for a new screen or flow. Returns the system prompt, coverage checklist, and opening questions tailored to the idea.",
  inputSchema: {
    type: "object",
    properties: {
      idea: {
        type: "string",
        description: "A plain-language description of the screen or flow to brainstorm.",
      },
    },
    required: ["idea"],
  },
};

const brainstormAssessTool: Tool = {
  name: "kotikit_brainstorm_assess",
  description:
    "Assess coverage of a brainstorm session. Returns open dimensions and suggested questions, or a ready-to-save draft template when all dimensions are covered.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        description: "The scope slug for this brainstorm (e.g. 'checkout-flow', 'profile-page').",
      },
      coverage: {
        type: "object",
        description: "Map of DimensionKey to 'covered' | 'open'.",
        additionalProperties: { type: "string", enum: ["covered", "open"] },
      },
      notes: {
        type: "string",
        description: "Optional notes or summary to include in the draft description.",
      },
    },
    required: ["scope", "coverage"],
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBrainstormTools(registry: ToolRegistry, _ctx: ToolContext): void {
  registry.tools.push(brainstormStartTool, brainstormAssessTool);

  // Handler: kotikit_brainstorm_start
  registry.handlers.set("kotikit_brainstorm_start", async (args: unknown) => {
    try {
      const { idea } = args as { idea: string };
      const classification = classify(idea);
      const coverageChecklist = buildChecklist(classification);
      const firstQuestions = generateFirstQuestions(idea, classification);

      return toolText("Ready to brainstorm.", {
        classification,
        coverageChecklist,
        systemPrompt: BRAINSTORM_SYSTEM_PROMPT,
        firstQuestions,
        qualityBar:
          "any developer or designer could build this identically from the spec alone",
      });
    } catch (err) {
      return toolError(err);
    }
  });

  // Handler: kotikit_brainstorm_assess
  registry.handlers.set("kotikit_brainstorm_assess", async (args: unknown) => {
    try {
      const { scope, coverage, notes } = args as {
        scope: string;
        coverage: Record<string, "covered" | "open">;
        notes?: string;
      };

      const required = getRequiredDimensions(coverage);
      const open = findOpenDimensions(required, coverage);

      if (open.length > 0) {
        const firstOpen = open[0];
        const suggestedQuestions = buildSuggestedQuestions(firstOpen);
        return toolText("Keep going — these dimensions still need coverage:", {
          status: "keepGoing",
          openDimensions: open,
          suggestedQuestions,
        });
      }

      const isMulti = required.includes("flowConnectivity");
      const draftTemplate = isMulti
        ? buildFlowDraft(scope, notes)
        : buildSingleScreenDraft(scope, notes);

      return toolText(
        "You're ready to save! Call spec_create or flow_create with this draft template.",
        {
          status: "readyToSave",
          draftTemplate,
        }
      );
    } catch (err) {
      return toolError(err);
    }
  });
}
