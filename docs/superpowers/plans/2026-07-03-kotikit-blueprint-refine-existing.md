# Kotikit Blueprint-First Intent And Refine Existing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic blueprint-first intent handling, preserve detailed PRD structure, support exact existing-frame replacement, and introduce a `refine-existing` flow for existing Figma pages with one or more target screens.

**Architecture:** Move rich product understanding out of substring classifiers and into validated start-input contracts. Preserve blueprints in graph state, derive brief/screen/flow state from those contracts, keep fallback heuristics tiny and short-prompt-only, and carry canvas replacement intent into executable canvas/apply metadata. Add `refine-existing` as a separate built-in flow that reuses the existing quality gates while requiring explicit target frames.

**Tech Stack:** TypeScript, Zod, Bun test runner, LangGraph runtime facade, kotikit graph nodes, Figma apply packet artifacts.

---

## File Structure

- Create `src/core/schemas/blueprint.ts`
  - Owns Zod schemas and exported types for `ScreenBlueprintInput`, `FlowBlueprintInput`, `CanvasIntentInput`, `ExistingDesignInventoryInput`, blueprint UI parts, target frames, and helper functions for primary-screen selection.
- Create `src/core/schemas/test/blueprint.test.ts`
  - Unit coverage for schema validation, duplicate ids, primary screen lookup, and canvas target validation.
- Modify `src/core/schemas/graph-state.ts`
  - Adds optional `screenBlueprint`, `flowBlueprint`, `canvasIntent`, and `existingDesignInventory` fields.
- Modify `src/core/graph/runtime.ts`
  - Adds blueprint, canvas intent, and existing-design inventory fields to `RuntimeStartInput` and seeds them into graph state.
- Modify `src/mcp/facade/tools.ts`
  - Adds `screenBlueprint`, `flowBlueprint`, `canvasIntent`, and `existingDesignInventory` to `kotikit_start` validation and public tool schema.
- Modify `src/mcp/facade/test/tools.test.ts`
  - Proves `kotikit_start` forwards structured blueprint/canvas input to the runtime.
- Modify `src/core/nodes/brief/index.ts`
  - Replaces substring/regex intent parsing with blueprint-preserving logic and tiny short-prompt fallback.
- Modify `src/core/nodes/brief/test/brief-nodes.test.ts`
  - Adds the requested regression tests around onboarding/admin/events/member-table behavior and blueprint override.
- Modify `src/core/domain/ux-envelope.ts`
  - Replaces archetype-driven selection with composable traits and explicit pattern-pack refs.
- Modify `src/core/domain/test/ux-envelope.test.ts`
  - Proves unknown/custom screens continue from traits and explicit pattern-pack refs do not use substring classification.
- Modify `src/core/nodes/ux/index.ts`
  - Passes blueprint traits from screen state into UX envelope building.
- Modify `src/core/schemas/artifact.ts`
  - Adds optional semantic metadata to `UICompositionPart`, adds optional canvas replacement metadata to canvas placements, and keeps legacy payloads parseable.
- Modify `src/core/domain/ui-composition-contract.ts`
  - Preserves part roles, region ids, and variable role requirements from blueprint-backed screen models.
- Modify `src/core/domain/variable-binding-plan.ts`
  - Binds only the semantic properties requested by a part when `variableRoles` are present.
- Modify `src/core/nodes/design-system/index.ts`
  - Enforces local-cache-only component/icon/variable matching; no Figma DS discovery fallback.
- Modify `src/core/nodes/design-system/test/design-system-nodes.test.ts`
  - Covers local DS source-of-truth behavior and missing-local-DS gap reporting.
- Modify `src/core/nodes/ui-composition/index.ts`
  - Feeds structured screen parts into composition and variable planning.
- Modify `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
  - Covers semantic role preservation and non-universal variable bindings.
- Modify `src/core/domain/canvas-plan.ts`
  - Adds target-frame canvas planning for `replace-existing-frame`.
- Modify `src/core/domain/test/canvas-plan.test.ts`
  - Covers replacement bounds, target node metadata, and legacy new-section planning.
- Modify `src/core/domain/figma-transaction-plan.ts`
  - Keeps replacement placement metadata available through transaction summaries.
- Modify `src/core/adapters/figma/apply-packet.ts`
  - Exposes replacement operation and target node id in the apply packet summary.
- Modify `src/core/nodes/draft/index.ts`
  - Uses `canvasIntent` when building canvas plans and apply packets.
- Modify `src/core/nodes/draft/test/draft-nodes.test.ts`
  - Covers exact replacement frame planning.
- Modify `src/core/domain/ui-quality-gate.ts`
  - Fails replacement/refine runs if evidence shows a new sibling frame instead of the planned target node.
- Modify `src/core/nodes/qa/test/qa-nodes.test.ts`
  - Covers replacement target-node invariant failures.
- Create `src/core/nodes/refine/index.ts`
  - Adds target validation/mapping nodes for the new existing-work flow.
- Create `src/core/nodes/refine/test/refine-nodes.test.ts`
  - Unit tests for single target, explicit multi-target mapping, and ambiguous multi-target clarification.
- Modify `src/core/nodes/built-in-registry.ts`
  - Registers refine nodes.
- Create `src/core/flows/built-in/refine-existing.flow.json`
  - Adds the built-in flow manifest for existing Figma work.
- Modify `src/core/flows/catalog.ts`
  - Adds `refine-existing.flow.json` to built-in flow loading.
- Modify `src/core/flows/test/catalog.test.ts`
  - Updates built-in flow ids and validates/compiles the new flow.
- Modify `src/core/nodes/test/built-in-node-registry.test.ts`
  - Updates built-in flow expectations and preserves stale-flow exclusions.
- Modify `src/mcp/facade/test/resources.test.ts`
  - Adds completion/resource coverage for `refine-existing`.
- Modify `docs/tools.md`
  - Documents blueprint input and `refine-existing`.
- Modify `.agents/skills/kotikit-auto/SKILL.md`
  - Instructs assistants to send blueprints for detailed PRDs and use `refine-existing` for existing frames/pages.
- Modify `e2e/graph/create-screen-flow.test.ts`
  - Adds a smoke test proving blueprint title/parts survive through `create-screen`.
- Create `e2e/graph/refine-existing-flow.test.ts`
  - Smoke test for the new flow with a fake existing target.

## Task 1: Blueprint And Canvas Intent Contracts

**Files:**
- Create: `src/core/schemas/blueprint.ts`
- Create: `src/core/schemas/test/blueprint.test.ts`
- Modify: `src/core/schemas/graph-state.ts`
- Modify: `src/core/graph/runtime.ts`
- Modify: `src/mcp/facade/tools.ts`
- Modify: `src/mcp/facade/test/tools.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add `src/core/schemas/test/blueprint.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  primaryScreenFromFlowBlueprint,
  ScreenBlueprintInputSchema,
} from "../blueprint.js";

describe("blueprint input schemas", () => {
  it("parses a screen blueprint with semantic UI parts", () => {
    expect(
      ScreenBlueprintInputSchema.parse({
        schemaVersion: "ScreenBlueprintInput/v1",
        title: "Events Experience",
        productDomain: "Mock Operations",
        confidence: "explicit",
        traits: {
          regions: [
            { id: "activity", name: "Activity", kind: "timeline", role: "main content" },
          ],
          stateScopes: ["page", "region"],
          repeatedPatterns: [
            { id: "event-items", name: "Event items", kind: "events", regionId: "activity" },
          ],
        },
        requiredUiParts: [
          {
            id: "event-timeline",
            name: "Event timeline",
            role: "timeline",
            regionId: "activity",
            variableRoles: [{ property: "text", semanticRole: "timeline label" }],
          },
        ],
        regions: [{ id: "activity", name: "Activity", role: "main content" }],
        states: [{ id: "filled", name: "Filled", kind: "filled" }],
      })
    ).toMatchObject({
      title: "Events Experience",
      requiredUiParts: [{ id: "event-timeline", role: "timeline" }],
    });
  });

  it("rejects duplicate flow screen ids", () => {
    expect(() =>
      FlowBlueprintInputSchema.parse({
        schemaVersion: "FlowBlueprintInput/v1",
        title: "Mock Flow",
        screens: [
          {
            schemaVersion: "ScreenBlueprintInput/v1",
            id: "events",
            title: "Events Experience",
            requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
          },
          {
            schemaVersion: "ScreenBlueprintInput/v1",
            id: "events",
            title: "Event Detail",
            requiredUiParts: [{ id: "details", name: "Details", role: "details" }],
          },
        ],
      })
    ).toThrow();
  });

  it("selects the explicit primary screen from a flow blueprint", () => {
    const flow = FlowBlueprintInputSchema.parse({
      schemaVersion: "FlowBlueprintInput/v1",
      title: "Mock Events Flow",
      primaryScreenId: "detail",
      screens: [
        {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "list",
          title: "Events Experience",
          requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
        },
        {
          schemaVersion: "ScreenBlueprintInput/v1",
          id: "detail",
          title: "Event Detail",
          requiredUiParts: [{ id: "summary", name: "Summary", role: "summary" }],
        },
      ],
    });

    expect(primaryScreenFromFlowBlueprint(flow)).toMatchObject({ id: "detail" });
  });

  it("validates replacement and refine canvas targets", () => {
    expect(
      CanvasIntentInputSchema.parse({
        mode: "replace-existing-frame",
        targetFrame: {
          nodeId: "12:34",
          name: "Existing Events Frame",
          bounds: { x: 100, y: 200, width: 1440, height: 900 },
        },
      })
    ).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:34" },
    });

    expect(
      CanvasIntentInputSchema.parse({
        mode: "refine-existing-targets",
        scope: "selected-frames",
        targets: [
          { nodeId: "12:34", screenId: "events", name: "Events" },
          { nodeId: "12:35", screenId: "detail", name: "Event Detail" },
        ],
      })
    ).toMatchObject({
      mode: "refine-existing-targets",
      targets: [{ screenId: "events" }, { screenId: "detail" }],
    });
  });

  it("parses compact existing design inventory for non-kotikit Figma pages", () => {
    expect(
      ExistingDesignInventoryInputSchema.parse({
        schemaVersion: "ExistingDesignInventoryInput/v1",
        source: "figma-scan",
        fileKey: "FILE",
        pageId: "1:2",
        pageName: "Mock Existing Page",
        targets: [
          {
            nodeId: "12:34",
            name: "Events Frame",
            kind: "frame",
            role: "primary screen",
            screenId: "events",
            bounds: { x: 0, y: 0, width: 1280, height: 720 },
            detectedTraits: {
              regions: [{ id: "activity", name: "Activity", kind: "timeline" }],
              repeatedPatterns: [{ id: "event-items", name: "Event items", kind: "events" }],
            },
            componentRefs: ["local-card-key"],
            variableRefs: ["local-color-bg"],
          },
        ],
      })
    ).toMatchObject({
      source: "figma-scan",
      targets: [expect.objectContaining({ nodeId: "12:34", screenId: "events" })],
    });
  });
});
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
bun test src/core/schemas/test/blueprint.test.ts
```

Expected: fail because `src/core/schemas/blueprint.ts` does not exist.

- [ ] **Step 3: Add blueprint schemas**

Create `src/core/schemas/blueprint.ts`:

```ts
import { z } from "zod";
import { BoundsSchema } from "./artifact.js";

const ConfidenceSchema = z.enum(["explicit", "inferred", "low"]);

const BlueprintVariableRoleSchema = z.strictObject({
  property: z.enum(["fill", "text", "effect", "spacing", "radius", "stroke", "shadow"]),
  semanticRole: z.string().min(1),
  optional: z.boolean().optional(),
});

const BlueprintUiPartSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  regionId: z.string().min(1).optional(),
  priority: z.enum(["primary", "secondary", "supporting"]).optional(),
  componentIntent: z.string().min(1).optional(),
  variableRoles: z.array(BlueprintVariableRoleSchema).optional(),
});

const BlueprintRegionSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
});

const BlueprintRepeatedPatternSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  partId: z.string().min(1).optional(),
  regionId: z.string().min(1).optional(),
});

const BlueprintStateSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z
    .enum(["filled", "loading", "empty", "no-results", "error", "permission", "success", "custom"])
    .default("custom"),
});

const BlueprintRegionKindSchema = z.enum([
  "table",
  "list",
  "timeline",
  "chart",
  "form",
  "detail-panel",
  "custom",
]);

const BlueprintStateScopeSchema = z.enum(["page", "region", "component", "flow"]);

const BlueprintRepeatedPatternKindSchema = z.enum(["rows", "cards", "events", "steps", "custom"]);

const BlueprintTraitRegionSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: BlueprintRegionKindSchema,
  role: z.string().min(1).optional(),
});

const BlueprintTraitRepeatedPatternSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: BlueprintRepeatedPatternKindSchema,
  regionId: z.string().min(1).optional(),
  partId: z.string().min(1).optional(),
});

const BlueprintTraitsSchema = z.strictObject({
  regions: z.array(BlueprintTraitRegionSchema).optional(),
  stateScopes: z.array(BlueprintStateScopeSchema).optional(),
  repeatedPatterns: z.array(BlueprintTraitRepeatedPatternSchema).optional(),
  patternPackIds: z.array(z.string().min(1)).optional(),
});

export const ScreenBlueprintInputSchema = z.strictObject({
  schemaVersion: z.literal("ScreenBlueprintInput/v1"),
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  productDomain: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  primaryGoal: z.string().min(1).optional(),
  primaryActor: z.string().min(1).optional(),
  confidence: ConfidenceSchema.optional(),
  traits: BlueprintTraitsSchema.optional(),
  requiredUiParts: z.array(BlueprintUiPartSchema).min(1),
  repeatedPatterns: z.array(BlueprintRepeatedPatternSchema).optional(),
  regions: z.array(BlueprintRegionSchema).optional(),
  states: z.array(BlueprintStateSchema).optional(),
  designSystemHints: z.array(z.string().min(1)).optional(),
});

export const FlowBlueprintInputSchema = z
  .strictObject({
    schemaVersion: z.literal("FlowBlueprintInput/v1"),
    title: z.string().min(1),
    productDomain: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    confidence: ConfidenceSchema.optional(),
    screens: z.array(ScreenBlueprintInputSchema.extend({ id: z.string().min(1) })).min(1),
    entryScreenId: z.string().min(1).optional(),
    primaryScreenId: z.string().min(1).optional(),
    transitions: z
      .array(
        z.strictObject({
          fromScreenId: z.string().min(1),
          toScreenId: z.string().min(1),
          trigger: z.string().min(1),
        })
      )
      .optional(),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    flow.screens.forEach((screen, index) => {
      if (ids.has(screen.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["screens", index, "id"],
          message: `Duplicate screen id ${screen.id}.`,
        });
      }
      ids.add(screen.id);
    });

    [flow.entryScreenId, flow.primaryScreenId]
      .filter((id): id is string => id !== undefined)
      .forEach((id) => {
        if (!ids.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["primaryScreenId"],
            message: `Flow references missing screen id ${id}.`,
          });
        }
      });
  });

const CanvasTargetFrameInputSchema = z.strictObject({
  nodeId: z.string().min(1),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  screenId: z.string().min(1).optional(),
  bounds: BoundsSchema.optional(),
});

export const ExistingDesignInventoryInputSchema = z.strictObject({
  schemaVersion: z.literal("ExistingDesignInventoryInput/v1"),
  source: z.enum(["figma-scan", "plugin-selection", "assistant-observed"]),
  fileKey: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  pageName: z.string().min(1).optional(),
  capturedAt: z.string().min(1).optional(),
  targets: z
    .array(
      z.strictObject({
        nodeId: z.string().min(1),
        name: z.string().min(1),
        kind: z.enum(["frame", "section", "component", "instance", "group", "unknown"]),
        bounds: BoundsSchema.optional(),
        screenId: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        detectedTraits: BlueprintTraitsSchema.optional(),
        componentRefs: z.array(z.string().min(1)).optional(),
        variableRefs: z.array(z.string().min(1)).optional(),
      })
    )
    .min(1),
});

export const CanvasIntentInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("create-new-section"),
    sectionName: z.string().min(1).optional(),
  }),
  z.strictObject({
    mode: z.literal("replace-existing-frame"),
    targetFrame: CanvasTargetFrameInputSchema,
  }),
  z.strictObject({
    mode: z.literal("refine-existing-targets"),
    scope: z.enum(["selected-frame", "selected-frames", "page"]),
    targets: z.array(CanvasTargetFrameInputSchema).min(1),
  }),
]);

export type ScreenBlueprintInput = z.infer<typeof ScreenBlueprintInputSchema>;
export type FlowBlueprintInput = z.infer<typeof FlowBlueprintInputSchema>;
export type CanvasIntentInput = z.infer<typeof CanvasIntentInputSchema>;
export type ExistingDesignInventoryInput = z.infer<typeof ExistingDesignInventoryInputSchema>;

export function primaryScreenFromFlowBlueprint(
  flow: FlowBlueprintInput
): FlowBlueprintInput["screens"][number] {
  return (
    flow.screens.find((screen) => screen.id === flow.primaryScreenId) ??
    flow.screens.find((screen) => screen.id === flow.entryScreenId) ??
    flow.screens[0]
  );
}
```

- [ ] **Step 4: Extend graph state and runtime start input**

Modify `src/core/schemas/graph-state.ts`:

```ts
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  ScreenBlueprintInputSchema,
} from "./blueprint.js";
```

Add fields to `KotikitGraphStateSchema` near `userIntent`:

```ts
  screenBlueprint: ScreenBlueprintInputSchema.optional(),
  flowBlueprint: FlowBlueprintInputSchema.optional(),
  canvasIntent: CanvasIntentInputSchema.optional(),
  existingDesignInventory: ExistingDesignInventoryInputSchema.optional(),
```

Modify `src/core/graph/runtime.ts` imports:

```ts
import type {
  CanvasIntentInput,
  ExistingDesignInventoryInput,
  FlowBlueprintInput,
  ScreenBlueprintInput,
} from "../schemas/blueprint.js";
```

Extend `RuntimeStartInput`:

```ts
export type RuntimeStartInput = {
  project: KotikitGraphState["project"];
  userIntent?: string;
  screenBlueprint?: ScreenBlueprintInput;
  flowBlueprint?: FlowBlueprintInput;
  canvasIntent?: CanvasIntentInput;
  existingDesignInventory?: ExistingDesignInventoryInput;
  figmaTarget?: KotikitGraphState["figmaTarget"];
  figmaDefaults?: KotikitGraphState["figmaDefaults"];
  designSystem?: KotikitGraphState["designSystem"];
  feedback?: KotikitGraphState["feedback"];
};
```

Seed the new fields when creating graph state:

```ts
        screenBlueprint: startInput.input.screenBlueprint,
        flowBlueprint: startInput.input.flowBlueprint,
        canvasIntent: startInput.input.canvasIntent,
        existingDesignInventory: startInput.input.existingDesignInventory,
```

- [ ] **Step 5: Extend `kotikit_start` validation and forwarding**

Modify `src/mcp/facade/tools.ts` imports:

```ts
import {
  CanvasIntentInputSchema,
  ExistingDesignInventoryInputSchema,
  FlowBlueprintInputSchema,
  ScreenBlueprintInputSchema,
} from "../../core/schemas/blueprint.js";
```

Extend `StartInputSchema.input`:

```ts
      screenBlueprint: ScreenBlueprintInputSchema.optional(),
      flowBlueprint: FlowBlueprintInputSchema.optional(),
      canvasIntent: CanvasIntentInputSchema.optional(),
      existingDesignInventory: ExistingDesignInventoryInputSchema.optional(),
```

Add public tool schema properties under `kotikit_start.input.properties`:

```ts
            screenBlueprint: {
              type: "object",
              description:
                "Structured one-screen blueprint authored by the assistant from the designer request.",
            },
            flowBlueprint: {
              type: "object",
              description:
                "Structured multi-screen blueprint authored by the assistant from the designer request.",
            },
            canvasIntent: {
              type: "object",
              description:
                "Canvas operation intent, such as creating a new section or replacing existing Figma targets.",
            },
            existingDesignInventory: {
              type: "object",
              description:
                "Compact inventory of existing Figma page/frame targets for refine-existing flows.",
            },
```

Forward parsed input into `startInput`:

```ts
        ...(input.input?.screenBlueprint === undefined
          ? {}
          : { screenBlueprint: input.input.screenBlueprint }),
        ...(input.input?.flowBlueprint === undefined
          ? {}
          : { flowBlueprint: input.input.flowBlueprint }),
        ...(input.input?.canvasIntent === undefined ? {} : { canvasIntent: input.input.canvasIntent }),
        ...(input.input?.existingDesignInventory === undefined
          ? {}
          : { existingDesignInventory: input.input.existingDesignInventory }),
```

- [ ] **Step 6: Add MCP forwarding test**

Add this case to `src/mcp/facade/test/tools.test.ts` near the existing `kotikit_start` tests:

```ts
  it("starts flows with structured blueprint and canvas intent", async () => {
    let captured: unknown;
    const runtime = {
      ...makeRuntime(),
      async startFlow(input): Promise<RuntimeRunResult> {
        captured = input.input;
        return {
          runId: "run-1",
          status: "running",
          state: {
            ...makeState("running"),
            screenBlueprint: input.input.screenBlueprint,
            canvasIntent: input.input.canvasIntent,
            existingDesignInventory: input.input.existingDesignInventory,
          },
        };
      },
    } satisfies FacadeRuntime;
    const registry = makeRegistry();
    registerFacadeTools(registry, makeCtx(), { runtime });

    const result = await callTool(registry, "kotikit_start", {
      flowId: "create-screen",
      input: {
        userIntent: "Create the Events Experience from the supplied PRD.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          title: "Events Experience",
          requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
        },
        canvasIntent: {
          mode: "replace-existing-frame",
          targetFrame: { nodeId: "12:34", name: "Existing Events Frame" },
        },
        existingDesignInventory: {
          schemaVersion: "ExistingDesignInventoryInput/v1",
          source: "figma-scan",
          targets: [{ nodeId: "12:34", name: "Existing Events Frame", kind: "frame" }],
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toMatchObject({
      screenBlueprint: { title: "Events Experience" },
      canvasIntent: { mode: "replace-existing-frame", targetFrame: { nodeId: "12:34" } },
      existingDesignInventory: {
        targets: [expect.objectContaining({ nodeId: "12:34" })],
      },
    });
  });
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
bun test src/core/schemas/test/blueprint.test.ts src/mcp/facade/test/tools.test.ts src/core/domain/test/context-durability.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/schemas/blueprint.ts src/core/schemas/test/blueprint.test.ts src/core/schemas/graph-state.ts src/core/graph/runtime.ts src/mcp/facade/tools.ts src/mcp/facade/test/tools.test.ts
git commit -m "feat(core): add blueprint start input contracts"
```

## Task 2: Blueprint-Preserving Brief Node

**Files:**
- Modify: `src/core/nodes/brief/index.ts`
- Modify: `src/core/nodes/brief/test/brief-nodes.test.ts`

- [ ] **Step 1: Add failing regression tests**

Add these tests to `src/core/nodes/brief/test/brief-nodes.test.ts`:

```ts
  it("does not let detailed mocked domain names hijack title or classification", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: [
          "Create a detailed Events experience for a mocked operations dashboard.",
          "The PRD mentions mocked service domains: Onboarding, Retrieval, Repair, and Inventory.",
          "Show upcoming event activity, priority indicators, and a slide-over detail panel.",
        ].join(" "),
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      schemaVersion: "ScreenModel/v1",
      title: expect.not.stringMatching(/Onboarding Flow|Members Table/),
    });
    expect(result.statePatch?.screen).not.toMatchObject({
      requiredUiParts: expect.arrayContaining(["pagination", "row avatar", "row action menu"]),
    });
  });

  it("preserves a blueprint Events Experience title and explicit UI parts", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create the screen from the supplied product brief.",
        screenBlueprint: {
          schemaVersion: "ScreenBlueprintInput/v1",
          title: "Events Experience",
          productDomain: "Mock Operations",
          requiredUiParts: [
            { id: "event-stream", name: "Event stream", role: "timeline" },
            { id: "priority-pill", name: "Priority indicator", role: "status indicator" },
            { id: "detail-panel", name: "Detail panel", role: "context panel" },
          ],
          repeatedPatterns: [{ id: "event-items", name: "Event items", partId: "event-stream" }],
          regions: [{ id: "activity", name: "Activity", role: "main content" }],
        },
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Events Experience",
      productDomain: "Mock Operations",
      requiredUiParts: ["Event stream", "Priority indicator", "Detail panel"],
      uiParts: [
        expect.objectContaining({ id: "event-stream", role: "timeline" }),
        expect.objectContaining({ id: "detail-panel", role: "context panel" }),
      ],
      repeatedPatterns: ["Event items"],
      regions: {
        tables: [],
        lists: [],
        forms: [],
        custom: ["Activity"],
      },
    });
  });

  it("does not infer table parts from admin dashboard wording alone", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent:
          "Create an admin dashboard overview for mocked operations leadership with alerts and service health.",
      })
    );

    expect(result.statePatch?.screen).not.toMatchObject({
      requiredUiParts: expect.arrayContaining([
        "data table",
        "pagination",
        "row avatar",
        "row action menu",
      ]),
    });
  });

  it("keeps explicit short members table fallback working", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({ userIntent: "Create members table" })
    );

    expect(result.statePatch?.screen).toMatchObject({
      title: "Members Table",
      requiredUiParts: expect.arrayContaining(["data table", "toolbar", "primary action"]),
      repeatedPatterns: expect.arrayContaining(["table rows"]),
    });
  });

  it("preserves flow blueprint structure while selecting the primary screen", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: "Create this mocked three-screen Events flow.",
        flowBlueprint: {
          schemaVersion: "FlowBlueprintInput/v1",
          title: "Events Flow",
          productDomain: "Mock Operations",
          primaryScreenId: "events",
          screens: [
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "events",
              title: "Events Experience",
              requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
            },
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "detail",
              title: "Event Detail",
              requiredUiParts: [{ id: "summary", name: "Summary", role: "summary" }],
            },
          ],
        },
      })
    );

    expect(result.statePatch?.screen).toMatchObject({ title: "Events Experience" });
    expect(result.statePatch?.flowModel).toMatchObject({
      title: "Events Flow",
      screens: [
        expect.objectContaining({ id: "events", title: "Events Experience" }),
        expect.objectContaining({ id: "detail", title: "Event Detail" }),
      ],
    });
  });

  it("marks detailed intent without blueprint as low confidence instead of guessing", async () => {
    const result = await runBriefNode(
      "brief.inferScreenBlueprint",
      baseState({
        userIntent: [
          "Create a production-ready mocked scheduling cockpit.",
          "The experience includes event risk, operational priorities, historical notes, side panels,",
          "bulk transitions, audit detail, and responsive behavior across multiple breakpoints.",
        ].join(" "),
      })
    );

    expect(result.statePatch?.screen).toMatchObject({
      confidence: "low",
      requiredUiParts: expect.arrayContaining(["page shell", "content heading", "primary action"]),
    });
    expect(result.statePatch?.screen).not.toMatchObject({
      requiredUiParts: expect.arrayContaining(["pagination", "row avatar", "row action menu"]),
    });
  });
```

- [ ] **Step 2: Run brief tests and verify they fail**

Run:

```bash
bun test src/core/nodes/brief/test/brief-nodes.test.ts
```

Expected: fail because the current node still uses substring title/classification/table inference and does not write `flowModel`.

- [ ] **Step 3: Replace intent parsing with blueprint-first helpers**

Modify `src/core/nodes/brief/index.ts`:

```ts
import {
  type FlowBlueprintInput,
  primaryScreenFromFlowBlueprint,
  type ScreenBlueprintInput,
} from "../../schemas/blueprint.js";
```

Extend local `ScreenBlueprint` with compatibility fields:

```ts
type ScreenBlueprint = {
  schemaVersion: "ScreenModel/v1";
  title: string;
  productDomain?: string;
  description: string;
  confidence?: "explicit" | "inferred" | "low";
  traits?: ScreenBlueprintInput["traits"];
  requiredUiParts: string[];
  uiParts?: ScreenBlueprintInput["requiredUiParts"];
  repeatedPatterns: string[];
  states: string[];
  regions: {
    tables: string[];
    lists: string[];
    forms: string[];
    custom?: string[];
  };
  designSystemHints: string[];
};
```

Change `brief.inferScreenBlueprint` state reads/writes:

```ts
    stateReads: ["userIntent", "brief", "designSystem", "screenBlueprint", "flowBlueprint"],
    stateWrites: ["screen", "flowModel"],
```

Use blueprint first:

```ts
      const blueprint = screenBlueprintForState(state);
      const screen = blueprint.screen;
      return {
        statePatch: {
          screen,
          ...(blueprint.flowModel === undefined ? {} : { flowModel: blueprint.flowModel }),
        },
      } satisfies RuntimeNodeOutput;
```

Add helpers:

```ts
function screenBlueprintForState(state: KotikitGraphState): {
  screen: ScreenBlueprint;
  flowModel?: Record<string, unknown>;
} {
  if (state.screenBlueprint !== undefined) {
    return { screen: screenFromInputBlueprint(state.screenBlueprint, state.userIntent) };
  }
  if (state.flowBlueprint !== undefined) {
    const primary = primaryScreenFromFlowBlueprint(state.flowBlueprint as FlowBlueprintInput);
    return {
      screen: screenFromInputBlueprint(primary, state.userIntent),
      flowModel: flowModelFromInputBlueprint(state.flowBlueprint as FlowBlueprintInput),
    };
  }
  return { screen: fallbackScreenBlueprint(intentFromState(state), state.designSystem) };
}

function screenFromInputBlueprint(
  blueprint: ScreenBlueprintInput,
  userIntent: string | undefined
): ScreenBlueprint {
  return {
    schemaVersion: "ScreenModel/v1",
    title: blueprint.title,
    ...(blueprint.productDomain === undefined ? {} : { productDomain: blueprint.productDomain }),
    description: blueprint.description ?? userIntent ?? blueprint.title,
    confidence: blueprint.confidence ?? "explicit",
    ...(blueprint.traits === undefined ? {} : { traits: blueprint.traits }),
    requiredUiParts: blueprint.requiredUiParts.map((part) => part.name),
    uiParts: blueprint.requiredUiParts,
    repeatedPatterns: (blueprint.repeatedPatterns ?? []).map((pattern) => pattern.name),
    states: (blueprint.states ?? []).map((state) => state.kind),
    regions: {
      tables: [],
      lists: [],
      forms: [],
      custom: (blueprint.regions ?? []).map((region) => region.name),
    },
    designSystemHints: blueprint.designSystemHints ?? [],
  };
}

function flowModelFromInputBlueprint(flow: FlowBlueprintInput): Record<string, unknown> {
  return {
    schemaVersion: "FlowModel/v1",
    title: flow.title,
    ...(flow.productDomain === undefined ? {} : { productDomain: flow.productDomain }),
    ...(flow.description === undefined ? {} : { description: flow.description }),
    screens: flow.screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      requiredUiParts: screen.requiredUiParts.map((part) => part.name),
      uiParts: screen.requiredUiParts,
      repeatedPatterns: (screen.repeatedPatterns ?? []).map((pattern) => pattern.name),
    })),
    ...(flow.entryScreenId === undefined ? {} : { entryScreenId: flow.entryScreenId }),
    ...(flow.primaryScreenId === undefined ? {} : { primaryScreenId: flow.primaryScreenId }),
    transitions: flow.transitions ?? [],
  };
}
```

Remove the existing regex helper and remove special-case title mappings such as:

```ts
if (lower.includes("members") && lower.includes("table")) return "Members Table";
if (lower.includes("onboarding")) return "Onboarding Flow";
```

Replace `inferScreenBlueprint` fallback with a short-prompt-only helper:

```ts
function fallbackScreenBlueprint(intent: string, designSystem: unknown): ScreenBlueprint {
  const fallback = shortPromptFallback(intent);
  const requiredUiParts = fallback.requiredUiParts;
  return {
    schemaVersion: "ScreenModel/v1",
    title: fallback.title,
    description: intent,
    confidence: fallback.confidence,
    requiredUiParts,
    repeatedPatterns: fallback.repeatedPatterns,
    states: STANDARD_STATES,
    regions: fallback.regions,
    designSystemHints: designSystemHints(designSystem, requiredUiParts),
  };
}

function shortPromptFallback(intent: string): {
  title: string;
  confidence: "inferred" | "low";
  requiredUiParts: string[];
  repeatedPatterns: string[];
  regions: ScreenBlueprint["regions"];
} {
  const words = wordsFrom(intent);
  const isShort = words.length <= 8;
  const tableIndex = words.indexOf("table");
  const explicitTable = isShort && tableIndex > 0;
  const formIndex = words.indexOf("form");
  const explicitForm = isShort && formIndex > 0;

  if (explicitTable) {
    const subject = words[tableIndex - 1] ?? "items";
    return {
      title: titleCase(`${subject} table`),
      confidence: "inferred",
      requiredUiParts: [
        "page shell",
        "content heading",
        "primary action",
        "toolbar",
        "search",
        "filters",
        "data table",
      ],
      repeatedPatterns: ["table rows"],
      regions: { tables: [subject], lists: [], forms: [] },
    };
  }

  if (explicitForm) {
    const subject = words[formIndex - 1] ?? "details";
    return {
      title: titleCase(`${subject} form`),
      confidence: "inferred",
      requiredUiParts: [
        "page shell",
        "content heading",
        "primary action",
        "form fields",
        "secondary action",
      ],
      repeatedPatterns: ["form field rows"],
      regions: { tables: [], lists: [], forms: [subject] },
    };
  }

  return {
    title: neutralTitleFromIntent(intent),
    confidence: "low",
    requiredUiParts: ["page shell", "content heading", "primary action"],
    repeatedPatterns: [],
    regions: { tables: [], lists: [], forms: [] },
  };
}

function wordsFrom(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
```

Keep `titleFromIntent` only as a neutral fallback that does not contain product-specific mappings:

```ts
function neutralTitleFromIntent(intent: string): string {
  const words = wordsFrom(intent).filter(
    (word) =>
      ![
        "create",
        "make",
        "build",
        "design",
        "quick",
        "fast",
        "screen",
        "page",
        "flow",
        "with",
        "using",
        "from",
        "the",
        "a",
        "an",
      ].includes(word)
  );
  return titleCase(words.slice(0, 3).join(" ") || "Product Screen");
}
```

- [ ] **Step 4: Make classify/capture preserve blueprint titles**

In `brief.classifyIntent` and `brief.captureMinimalIntent`, derive classification/title from blueprints first:

```ts
function titleForState(state: KotikitGraphState, classification: BriefClassification): string {
  if (state.screenBlueprint !== undefined) return state.screenBlueprint.title;
  if (state.flowBlueprint !== undefined) return state.flowBlueprint.title;
  return fallbackTitleFromIntent(intentFromState(state), classification);
}

function classifyStateIntent(state: KotikitGraphState): BriefClassification {
  if (state.flowBlueprint !== undefined) return "multiScreen";
  if (state.screenBlueprint !== undefined) return "singleScreen";
  return classifyFallbackIntent(intentFromState(state));
}
```

Replace calls to `classifyIntent(intent)` and `titleFromIntent(intent, classification)` with these state-aware helpers.

- [ ] **Step 5: Run brief tests**

Run:

```bash
bun test src/core/nodes/brief/test/brief-nodes.test.ts
```

Expected: all brief tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/nodes/brief/index.ts src/core/nodes/brief/test/brief-nodes.test.ts
git commit -m "fix(brief): preserve blueprint intent over fallback heuristics"
```

## Task 3: Traits And Explicit Pattern Pack Refs

**Files:**
- Modify: `src/core/domain/ux-envelope.ts`
- Modify: `src/core/domain/test/ux-envelope.test.ts`
- Modify: `src/core/nodes/ux/index.ts`
- Modify: `src/core/domain/ux-pattern-pack.ts`
- Modify: `src/core/nodes/design-system/index.ts`

- [ ] **Step 1: Update failing UX trait tests**

Replace the first test in `src/core/domain/test/ux-envelope.test.ts`:

```ts
  it("keeps detailed admin dashboard wording unknown while preserving traits", () => {
    const envelope = buildUxEnvelope({
      userIntent:
        "Create a detailed admin dashboard experience for mocked operations alerts, notes, and service health.",
      screen: {
        title: "Operations Overview",
        requiredUiParts: ["alert summary", "service health", "notes panel"],
        traits: {
          regions: [
            { id: "alerts", name: "Alerts", kind: "list" },
            { id: "health", name: "Service health", kind: "chart" },
          ],
          stateScopes: ["page", "region"],
          repeatedPatterns: [{ id: "alerts", name: "Alert items", kind: "cards" }],
        },
      },
    });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      confidence: "low",
      primaryGoal: "Operations Overview",
      traitSummary: {
        regionKinds: ["list", "chart"],
        stateScopes: ["page", "region"],
        repeatedPatternKinds: ["cards"],
        patternPackIds: [],
      },
    });
  });

  it("uses explicit pattern pack refs without substring classification", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create a mocked access review workspace.",
      screen: {
        title: "Access Review",
        requiredUiParts: ["review table", "filter toolbar"],
        traits: {
          regions: [{ id: "review", name: "Review table", kind: "table" }],
          stateScopes: ["region"],
          repeatedPatterns: [{ id: "review-rows", name: "Review rows", kind: "rows" }],
          patternPackIds: ["admin-data-table"],
        },
      },
    });

    expect(envelope).toMatchObject({
      screenArchetype: "unknown",
      confidence: "inferred",
      primaryTask: "Manage members",
      traitSummary: {
        patternPackIds: ["admin-data-table"],
      },
    });
  });
```

Update the state-matrix test to pass explicit trait and pattern-pack metadata:

```ts
        screen: {
          title: "Admin Members",
          requiredUiParts: ["members table"],
          states: ["filled", "loading", "empty", "no-results", "error", "permission"],
          traits: {
            regions: [{ id: "members", name: "Members table", kind: "table" }],
            stateScopes: ["region"],
            repeatedPatterns: [{ id: "member-rows", name: "Member rows", kind: "rows" }],
            patternPackIds: ["admin-data-table"],
          },
        },
```

- [ ] **Step 2: Run UX tests and verify they fail**

Run:

```bash
bun test src/core/domain/test/ux-envelope.test.ts
```

Expected: fail because `screen.traits`, explicit `patternPackIds`, and `traitSummary` are not supported.

- [ ] **Step 3: Add pattern-pack lookup by explicit id**

Modify `src/core/domain/ux-pattern-pack.ts`:

```ts
export function selectPatternPacks(patternPackIds: string[] | undefined): UXPatternPack[] {
  if (patternPackIds === undefined || patternPackIds.length === 0) return [];
  return patternPackIds
    .map((id) => builtInPatternPacks.find((pack) => pack.id === id))
    .filter((pack): pack is UXPatternPack => pack !== undefined);
}
```

This lookup is id-based only. Do not use `intentKeywords` for detailed PRDs.

- [ ] **Step 4: Update UX envelope input and selection**

Modify `src/core/domain/ux-envelope.ts`:

```ts
type ScreenTraits = {
  regions?: { id?: string; name?: string; kind?: string }[];
  stateScopes?: string[];
  repeatedPatterns?: { id?: string; name?: string; kind?: string }[];
  patternPackIds?: string[];
};

type BuildUxEnvelopeInput = {
  userIntent: string;
  screen?: {
    title?: string;
    requiredUiParts?: string[];
    states?: string[];
    traits?: ScreenTraits;
  };
  patternPack?: UXPatternPack;
};
```

Replace broad user-intent classification in `buildUxEnvelope`:

```ts
  const explicitPatternPacks =
    input.patternPack === undefined ? selectPatternPacks(input.screen?.traits?.patternPackIds) : [];
  const patternPack = input.patternPack ?? explicitPatternPacks[0] ?? selectPatternPack("unknown");
  const screenArchetype: UXEnvelope["screenArchetype"] = "unknown";
```

Build a trait summary:

```ts
function traitSummaryFrom(traits: ScreenTraits | undefined): UXEnvelope["traitSummary"] {
  return {
    regionKinds: uniqueStrings((traits?.regions ?? []).flatMap((region) => optionalString(region.kind))),
    stateScopes: uniqueStrings((traits?.stateScopes ?? []).flatMap(optionalString)),
    repeatedPatternKinds: uniqueStrings(
      (traits?.repeatedPatterns ?? []).flatMap((pattern) => optionalString(pattern.kind))
    ),
    patternPackIds: uniqueStrings(traits?.patternPackIds ?? []),
  };
}

function optionalString(value: unknown): string[] {
  return typeof value === "string" && value.trim() !== "" ? [value.trim()] : [];
}
```

Include it in the returned envelope:

```ts
    traitSummary: traitSummaryFrom(input.screen?.traits),
```

Leave `classifyScreenArchetype` exported for compatibility, but change it to always return `unknown`:

```ts
export function classifyScreenArchetype(userIntent: string): UXEnvelope["screenArchetype"] {
  return "unknown";
}
```

This keeps legacy callers from receiving broad substring classification. The main path uses traits and explicit pattern-pack ids.

- [ ] **Step 5: Extend `UXEnvelope` schema for trait summary**

Modify `src/core/schemas/artifact.ts` near `UXEnvelopeSchema`:

```ts
const UXEnvelopeTraitSummarySchema = z.strictObject({
  regionKinds: z.array(z.string().min(1)),
  stateScopes: z.array(z.string().min(1)),
  repeatedPatternKinds: z.array(z.string().min(1)),
  patternPackIds: z.array(z.string().min(1)),
});
```

Add this field to `UXEnvelopeSchema`:

```ts
  traitSummary: UXEnvelopeTraitSummarySchema.optional(),
```

Keep `screenArchetype` in `UXEnvelope/v1` for compatibility, but new blueprint-driven runs should emit `unknown`.

- [ ] **Step 6: Pass traits through UX node screen extraction**

Modify `screenFrom` in `src/core/nodes/ux/index.ts`:

```ts
function screenFrom(value: unknown): {
  title?: string;
  requiredUiParts?: string[];
  states?: string[];
  traits?: {
    regions?: Record<string, unknown>[];
    stateScopes?: string[];
    repeatedPatterns?: Record<string, unknown>[];
    patternPackIds?: string[];
  };
} {
  const record = recordFrom(value);
  const traits = recordFrom(record.traits);
  return {
    title: stringFrom(record.title),
    requiredUiParts: stringArray(record.requiredUiParts),
    states: stringArray(record.states),
    traits:
      Object.keys(traits).length > 0
        ? {
            regions: recordArray(traits.regions),
            stateScopes: stringArray(traits.stateScopes),
            repeatedPatterns: recordArray(traits.repeatedPatterns),
            patternPackIds: stringArray(traits.patternPackIds),
          }
        : undefined,
  };
}
```

- [ ] **Step 7: Stop adding pattern-pack parts from `screenArchetype`**

Modify `patternPackParts` in `src/core/nodes/design-system/index.ts`:

```ts
function patternPackParts(state: KotikitGraphState): string[] {
  const traitSummary = recordFrom(recordFrom(state.uxEnvelope).traitSummary);
  const patternPackIds = stringArray(traitSummary.patternPackIds);
  return patternPackIds.flatMap((id) => selectPatternPacks([id]).flatMap((pack) => pack.componentRoles));
}
```

Update imports:

```ts
import { selectPatternPacks } from "../../domain/ux-pattern-pack.js";
```

Remove the old `selectPatternPack(archetype)` branch so `screenArchetype: "unknown"` does not block explicit traits, and broad archetypes do not add table/form/dashboard parts.

- [ ] **Step 8: Run UX and brief tests**

Run:

```bash
bun test src/core/domain/test/ux-envelope.test.ts src/core/nodes/ux/test/ux-nodes.test.ts src/core/nodes/design-system/test/design-system-nodes.test.ts src/core/nodes/brief/test/brief-nodes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/domain/ux-envelope.ts src/core/domain/test/ux-envelope.test.ts src/core/nodes/ux/index.ts src/core/domain/ux-pattern-pack.ts src/core/nodes/design-system/index.ts src/core/schemas/artifact.ts
git commit -m "fix(ux): replace archetypes with blueprint traits"
```

## Task 4: Local DS Source Of Truth, Semantic Parts, And Variable Bindings

**Files:**
- Modify: `src/core/schemas/artifact.ts`
- Modify: `src/core/domain/ui-composition-contract.ts`
- Modify: `src/core/domain/variable-binding-plan.ts`
- Modify: `src/core/nodes/ui-composition/index.ts`
- Modify: `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
- Modify: `src/core/nodes/design-system/index.ts`
- Modify: `src/core/nodes/design-system/test/design-system-nodes.test.ts`

- [ ] **Step 1: Add failing local DS source-of-truth tests**

Add to `src/core/nodes/design-system/test/design-system-nodes.test.ts`:

```ts
  it("reports local design-system gaps instead of requesting Figma DS search", async () => {
    const output = await runNode("designSystem.buildFitReport", {
      screen: {
        requiredUiParts: ["Event stream", "Priority indicator"],
        uiParts: [
          { id: "event-stream", name: "Event stream", role: "timeline" },
          { id: "priority-indicator", name: "Priority indicator", role: "status indicator" },
        ],
      },
      designSystem: {
        results: [],
        variables: [],
        icons: [],
      },
    });

    expect(output.statePatch?.fitReport).toMatchObject({
      sourcePolicy: {
        componentDiscovery: "local-cache-only",
        variableDiscovery: "local-cache-only",
        figmaDiscoveryAllowed: false,
      },
      missingComponents: expect.arrayContaining([
        expect.objectContaining({ requestedPart: "Event stream" }),
        expect.objectContaining({ requestedPart: "Priority indicator" }),
      ]),
    });
    expect(JSON.stringify(output)).not.toContain("figma-search");
    expect(JSON.stringify(output)).not.toContain("remote-discovery");
  });

  it("keeps local component and variable refs as the only reusable source", async () => {
    const output = await runNode("designSystem.buildFitReport", {
      screen: {
        requiredUiParts: ["Event stream"],
      },
      designSystem: {
        results: [
          {
            name: "Event stream",
            key: "local-event-stream-key",
            source: "local-component-db",
          },
        ],
        variables: [
          {
            kind: "color",
            name: "color.surface.default",
            id: "local-color-surface",
            source: "local-variables-cache",
          },
        ],
      },
    });

    expect(output.statePatch?.fitReport).toMatchObject({
      exactMatches: [
        expect.objectContaining({
          componentKey: "local-event-stream-key",
          source: "local-component-db",
        }),
      ],
      variableGaps: expect.not.arrayContaining([
        expect.objectContaining({ kind: "color" }),
      ]),
    });
  });
```

- [ ] **Step 2: Run design-system tests and verify they fail**

Run:

```bash
bun test src/core/nodes/design-system/test/design-system-nodes.test.ts
```

Expected: fail because `sourcePolicy` and local-source annotations are not emitted.

- [ ] **Step 3: Add local DS source policy to fit reports**

Modify the fit report type construction in `src/core/nodes/design-system/index.ts` so `designSystem.buildFitReport` always includes:

```ts
sourcePolicy: {
  componentDiscovery: "local-cache-only",
  variableDiscovery: "local-cache-only",
  iconDiscovery: "local-cache-only",
  figmaDiscoveryAllowed: false,
}
```

When building exact matches, substitutes, wrap candidates, icon matches, and variable refs, preserve or set local source metadata:

```ts
source: stringField(component, "source") ?? "local-component-db"
```

For variables:

```ts
source: stringField(variable, "source") ?? "local-variables-cache"
```

Do not add any fallback branch that calls Figma search or asks the agent to search Figma. Missing local coverage must remain `missingComponents`, `variableGaps`, or an approval/sync question handled by existing graph behavior.

- [ ] **Step 4: Run local DS tests**

Run:

```bash
bun test src/core/nodes/design-system/test/design-system-nodes.test.ts
```

Expected: all design-system node tests pass.

- [ ] **Step 5: Add failing composition and variable tests**

Add to `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`:

```ts
  it("preserves blueprint part roles and regions in the composition contract", async () => {
    const output = await runNode("ui.buildCompositionContract", {
      screen: {
        requiredUiParts: ["Event stream", "Priority indicator"],
        uiParts: [
          {
            id: "event-stream",
            name: "Event stream",
            role: "timeline",
            regionId: "activity",
            variableRoles: [{ property: "text", semanticRole: "timeline label" }],
          },
          {
            id: "priority-indicator",
            name: "Priority indicator",
            role: "status indicator",
            regionId: "activity",
            variableRoles: [
              { property: "fill", semanticRole: "status background" },
              { property: "text", semanticRole: "status label" },
            ],
          },
        ],
      },
      fitReport: {
        approvedPrimitiveExceptions: ["Event stream", "Priority indicator"],
      },
    });

    expect(output.statePatch?.uiComposition).toMatchObject({
      parts: [
        expect.objectContaining({
          id: "event-stream",
          role: "timeline",
          regionId: "activity",
          variableRoles: [{ property: "text", semanticRole: "timeline label" }],
        }),
        expect.objectContaining({
          id: "priority-indicator",
          role: "status indicator",
          regionId: "activity",
        }),
      ],
    });
  });

  it("uses semantic variable roles instead of binding every property to every part", async () => {
    const output = await runNode("ui.buildVariableBindingPlan", {
      uiComposition: {
        schemaVersion: "UICompositionContract/v1",
        parts: [
          {
            id: "event-stream",
            name: "Event stream",
            role: "timeline",
            source: "approved-primitive",
            primitiveReason: "test",
            variableRoles: [{ property: "text", semanticRole: "timeline label" }],
          },
          {
            id: "priority-indicator",
            name: "Priority indicator",
            role: "status indicator",
            source: "approved-primitive",
            primitiveReason: "test",
            variableRoles: [
              { property: "fill", semanticRole: "status background" },
              { property: "text", semanticRole: "status label" },
            ],
          },
        ],
      },
      designSystem: {
        variables: [
          { kind: "color", name: "color.status.warning.bg", id: "var-status-bg" },
          { kind: "text", name: "font.body.default", id: "var-body" },
          { kind: "spacing", name: "space.200", id: "var-space" },
        ],
      },
    });

    expect(output.statePatch?.variableBindingPlan).toMatchObject({
      bindings: expect.arrayContaining([
        expect.objectContaining({ targetId: "event-stream", property: "text", id: "var-body" }),
        expect.objectContaining({
          targetId: "priority-indicator",
          property: "fill",
          id: "var-status-bg",
        }),
      ]),
    });
    expect(output.statePatch?.variableBindingPlan).not.toMatchObject({
      bindings: expect.arrayContaining([
        expect.objectContaining({ targetId: "event-stream", property: "fill" }),
        expect.objectContaining({ targetId: "priority-indicator", property: "spacing" }),
      ]),
    });
  });
```

- [ ] **Step 6: Run composition tests and verify they fail**

Run:

```bash
bun test src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts
```

Expected: fail because `uiParts`, `regionId`, and `variableRoles` are not preserved.

- [ ] **Step 7: Extend artifact schemas**

Modify `src/core/schemas/artifact.ts` near `UICompositionPartSchema`:

```ts
const VariableRoleRequirementSchema = z.strictObject({
  property: z.enum(["fill", "text", "effect", "spacing", "radius", "stroke", "shadow"]),
  semanticRole: z.string().min(1),
  optional: z.boolean().optional(),
});
```

Add fields to `UICompositionPartSchema`:

```ts
  regionId: z.string().min(1).optional(),
  variableRoles: z.array(VariableRoleRequirementSchema).optional(),
```

- [ ] **Step 8: Preserve structured parts in composition**

Modify `src/core/domain/ui-composition-contract.ts`:

```ts
type RequestedUiPart = {
  id?: string;
  name: string;
  role?: string;
  regionId?: string;
  variableRoles?: UICompositionPart["variableRoles"];
};
```

Change input:

```ts
  requiredUiParts: Array<string | RequestedUiPart>;
```

Normalize parts before mapping:

```ts
  const requestedParts = input.requiredUiParts.map((part): RequestedUiPart =>
    typeof part === "string" ? { name: part } : part
  );

  const parts = requestedParts.map((part) => {
    const id = part.id ?? idFor(part.name);
    const role = part.role ?? roleFor(part.name);
```

When returning each part, include:

```ts
        ...(part.regionId === undefined ? {} : { regionId: part.regionId }),
        ...(part.variableRoles === undefined ? {} : { variableRoles: part.variableRoles }),
```

Use `part.name` instead of the old string variable in all matching calls:

```ts
    const existing = findFit(part.name, [...]);
    const draft = input.draftComponentPlan?.components?.find(
      (component) => normalize(component.name) === normalize(part.name)
    );
```

- [ ] **Step 9: Feed structured parts from the UI node**

Modify `src/core/nodes/ui-composition/index.ts`:

```ts
      const contract = buildUiCompositionContract({
        requiredUiParts: requestedUiPartsFromScreen(screen),
```

Add helper:

```ts
function requestedUiPartsFromScreen(screen: Record<string, unknown>): Array<string | Record<string, unknown>> {
  const structured = recordArray(screen.uiParts);
  return structured.length > 0 ? structured : stringArray(screen.requiredUiParts);
}
```

- [ ] **Step 10: Bind variables by part-level role requirements**

Modify `src/core/domain/variable-binding-plan.ts`:

```ts
type VariableRoleRequirement = NonNullable<
  UICompositionContract["parts"][number]["variableRoles"]
>[number];
```

Before the default full-property binding branches, add:

```ts
  const roleBindings = bindingsFromVariableRoles(input.uiComposition.parts, input.variables);
  if (roleBindings !== undefined) {
    return {
      schemaVersion: "VariableBindingPlan/v1",
      bindings: roleBindings,
    };
  }
```

Add helper:

```ts
function bindingsFromVariableRoles(
  parts: UICompositionContract["parts"],
  variables: VariableRef[]
): VariableBindingPlan["bindings"] | undefined {
  const partsWithRoles = parts.filter((part) => (part.variableRoles ?? []).length > 0);
  if (partsWithRoles.length === 0) return undefined;

  return partsWithRoles.flatMap((part) =>
    (part.variableRoles ?? []).flatMap((role) => {
      const variable = variableForRole(role, variables);
      return variable === undefined && role.optional === true
        ? []
        : variable === undefined
          ? [
              {
                targetId: part.id,
                property: role.property,
                source: "approved-literal" as const,
                literalValue: "draft-only",
                approvalRef: "approved-literal-variable-fallback",
              },
            ]
          : [variableBinding(part.id, role.property, variable)];
    })
  );
}

function variableForRole(
  role: VariableRoleRequirement,
  variables: VariableRef[]
): VariableRef | undefined {
  const byProperty = variables.filter((variable) => propertyForVariable(variable) === role.property);
  const semanticTokens = tokensFor(role.semanticRole);
  return (
    byProperty.find((variable) => {
      const nameTokens = tokensFor(variable.name ?? "");
      return semanticTokens.some((token) => nameTokens.includes(token));
    }) ?? byProperty[0]
  );
}

function tokensFor(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
```

This uses variable names as design-system evidence, not as product-intent classification.

- [ ] **Step 11: Run composition and local DS tests**

Run:

```bash
bun test src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/nodes/design-system/test/design-system-nodes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/core/schemas/artifact.ts src/core/domain/ui-composition-contract.ts src/core/domain/variable-binding-plan.ts src/core/nodes/ui-composition/index.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/nodes/design-system/index.ts src/core/nodes/design-system/test/design-system-nodes.test.ts
git commit -m "fix(ds): enforce local design-system source of truth"
```

## Task 5: Replace Existing Frame Canvas Planning

**Files:**
- Modify: `src/core/schemas/artifact.ts`
- Modify: `src/core/domain/canvas-plan.ts`
- Modify: `src/core/domain/test/canvas-plan.test.ts`
- Modify: `src/core/domain/figma-transaction-plan.ts`
- Modify: `src/core/adapters/figma/apply-packet.ts`
- Modify: `src/core/nodes/draft/index.ts`
- Modify: `src/core/nodes/draft/test/draft-nodes.test.ts`
- Modify: `src/core/domain/ui-quality-gate.ts`
- Modify: `src/core/nodes/qa/test/qa-nodes.test.ts`

- [ ] **Step 1: Add failing canvas domain test**

Add to `src/core/domain/test/canvas-plan.test.ts`:

```ts
  it("plans replacement inside an existing target frame", () => {
    const plan = buildCanvasPlan({
      sectionName: "Existing Mock Page",
      sectionId: "section-existing",
      screenTitle: "Events Experience",
      screenSize: { width: 1440, height: 900 },
      states: [{ id: "filled", label: "Filled", kind: "filled" }],
      draftComponents: [],
      replacementTarget: {
        nodeId: "12:34",
        name: "Existing Events Frame",
        bounds: { x: 300, y: 400, width: 1280, height: 720 },
      },
    });

    expect(plan).toMatchObject({
      section: { id: "section-existing", name: "Existing Mock Page" },
      coordinateSpace: "section-relative",
      screenSize: { width: 1280, height: 720 },
      placements: [
        expect.objectContaining({
          label: "Existing Events Frame - Filled",
          canvasOperation: "replace-target-frame",
          operation: "replace",
          targetNodeId: "12:34",
          bounds: { x: 300, y: 400, width: 1280, height: 720 },
        }),
      ],
    });
  });
```

- [ ] **Step 2: Run canvas tests and verify they fail**

Run:

```bash
bun test src/core/domain/test/canvas-plan.test.ts
```

Expected: fail because `replacementTarget`, `operation`, and `targetNodeId` do not exist.

- [ ] **Step 3: Extend canvas placement schema compatibly**

Modify `CanvasPlacementSchema` in `src/core/schemas/artifact.ts`:

```ts
  canvasOperation: z
    .enum(["create-new-frame", "replace-target-frame"])
    .default("create-new-frame"),
  operation: z.enum(["create", "replace"]).default("create"),
  targetNodeId: IncrementalRefSchema.optional(),
```

Add plan-level mode to `CanvasPlanSchema`:

```ts
  mode: z.enum(["create", "replace", "refine"]).default("create"),
```

Add super-refine validation in `CanvasPlanSchema` placement loop:

```ts
      if (
        (placement.operation === "replace" ||
          placement.canvasOperation === "replace-target-frame") &&
        placement.targetNodeId === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", index, "targetNodeId"],
          message: "Replacement placements require targetNodeId.",
        });
      }
```

- [ ] **Step 4: Add replacement target support to canvas plan builder**

Modify `src/core/domain/canvas-plan.ts` input type:

```ts
  replacementTarget?: {
    nodeId: string;
    name?: string;
    bounds: Bounds;
  };
```

At the top of `buildCanvasPlan`, branch:

```ts
  if (input.replacementTarget !== undefined) {
    return buildReplacementCanvasPlan(input as typeof input & {
      replacementTarget: NonNullable<typeof input.replacementTarget>;
    });
  }
```

Add helper:

```ts
function buildReplacementCanvasPlan(input: {
  sectionName: string;
  sectionId?: string;
  screenTitle: string;
  states: { id: string; label: string; kind: string }[];
  replacementTarget: { nodeId: string; name?: string; bounds: Bounds };
  sectionStyle?: CanvasPlan["sectionStyle"];
}): CanvasPlan {
  const target = input.replacementTarget;
  const zone: CanvasZone = {
    id: "zone-existing-target",
    kind: "screen-states",
    label: target.name ?? input.screenTitle,
    bounds: target.bounds,
  };
  const placements = input.states.map((state): CanvasPlacement => ({
    id: `state-${state.id}`,
    kind: "screen-state",
    stateId: state.id,
    label: `${target.name ?? input.screenTitle} - ${state.label}`,
    bounds: target.bounds,
    parentZoneId: zone.id,
    transactionId: `txn-state-${state.id}`,
    canvasOperation: "replace-target-frame",
    operation: "replace",
    targetNodeId: target.nodeId,
  }));
  const plan: CanvasPlan = {
    schemaVersion: "CanvasPlan/v1",
    mode: "replace",
    section: {
      ...(input.sectionId === undefined ? {} : { id: input.sectionId }),
      name: input.sectionName,
    },
    coordinateSpace: "section-relative",
    screenSize: { width: target.bounds.width, height: target.bounds.height },
    minGap: SCREEN_GAP,
    sectionStyle: input.sectionStyle ?? DEFAULT_SECTION_STYLE,
    zones: [zone],
    placements,
    strategy: {
      primaryFirst: true,
      creationOrder: placements.map((placement) => placement.id),
      designerNotes: [
        "Replace the exact existing target frame in place; do not create a new section or sibling screen frame.",
      ],
    },
  };

  const parsed = CanvasPlanSchema.parse(plan);
  verifyCanvasPlan(parsed);
  return parsed;
}
```

- [ ] **Step 5: Pass canvas intent from draft node**

Modify `draft.buildCanvasPlan` in `src/core/nodes/draft/index.ts`:

```ts
      const replacementTarget = replacementTargetFrom(state);
      const screenSize =
        replacementTarget?.bounds === undefined
          ? { width: 1440, height: 900 }
          : { width: replacementTarget.bounds.width, height: replacementTarget.bounds.height };
      const canvasPlan = buildCanvasPlan({
        sectionName: section.name,
        ...(section.id === undefined ? {} : { sectionId: section.id }),
        screenTitle: screenTitle(state),
        screenSize,
        states: canvasStatesFrom(state),
        draftComponents: state.draftComponentPlan?.components ?? [],
        sectionStyle: state.figmaDefaults?.section,
        ...(replacementTarget === undefined ? {} : { replacementTarget }),
      });
```

Add helper:

```ts
function replacementTargetFrom(state: KotikitGraphState):
  | { nodeId: string; name?: string; bounds: { x: number; y: number; width: number; height: number } }
  | undefined {
  const canvasIntent = recordFrom(state.canvasIntent);
  if (canvasIntent.mode !== "replace-existing-frame") return undefined;
  const target = recordFrom(canvasIntent.targetFrame);
  const bounds = recordFrom(target.bounds);
  if (
    typeof target.nodeId !== "string" ||
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    return undefined;
  }
  return {
    nodeId: target.nodeId,
    ...(typeof target.name === "string" ? { name: target.name } : {}),
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
```

- [ ] **Step 6: Preserve replacement metadata in transaction summaries**

Modify `FigmaTransactionSummary` in `src/core/adapters/figma/apply-packet.ts`:

```ts
  canvasOperation: CanvasPlan["placements"][number]["canvasOperation"];
  operation: CanvasPlan["placements"][number]["operation"];
  targetNodeId?: string;
```

In `summarizeTransactionPlan`, include:

```ts
      canvasOperation: placement.canvasOperation,
      operation: placement.operation,
      ...(placement.targetNodeId === undefined ? {} : { targetNodeId: placement.targetNodeId }),
```

No transaction kind change is required in this slice. The active transaction can remain `create-screen-state`, while the placement operation tells the Figma application worker to replace the existing target frame.

- [ ] **Step 7: Add draft node replacement test**

Add to `src/core/nodes/draft/test/draft-nodes.test.ts`:

```ts
  it("builds a replacement canvas plan for an exact existing frame", async () => {
    const output = await runNode("draft.buildCanvasPlan", {
      screen: { title: "Events Experience", states: ["filled"] },
      canvasIntent: {
        mode: "replace-existing-frame",
        targetFrame: {
          nodeId: "12:34",
          name: "Existing Events Frame",
          bounds: { x: 100, y: 200, width: 1280, height: 720 },
        },
      },
      figmaTarget: {
        section: { id: "section-existing", name: "Existing Mock Page" },
      },
    });

    expect(output.statePatch?.canvasPlan).toMatchObject({
      mode: "replace",
      screenSize: { width: 1280, height: 720 },
      placements: [
        expect.objectContaining({
          canvasOperation: "replace-target-frame",
          operation: "replace",
          targetNodeId: "12:34",
          bounds: { x: 100, y: 200, width: 1280, height: 720 },
        }),
      ],
    });
  });
```

- [ ] **Step 8: Add QA invariant for exact replacement**

Add to `src/core/nodes/qa/test/qa-nodes.test.ts`:

```ts
  it("fails replacement QA when apply ledger created a sibling instead of replacing the target", async () => {
    const output = await runNode("qa.runUiQualityGate", {
      canvasPlan: {
        schemaVersion: "CanvasPlan/v1",
        mode: "replace",
        section: { id: "section-existing", name: "Existing Mock Page" },
        coordinateSpace: "section-relative",
        screenSize: { width: 1280, height: 720 },
        minGap: 80,
        zones: [],
        placements: [
          {
            id: "state-filled",
            kind: "screen-state",
            stateId: "filled",
            label: "Existing Events Frame - Filled",
            bounds: { x: 100, y: 200, width: 1280, height: 720 },
            transactionId: "txn-state-filled",
            canvasOperation: "replace-target-frame",
            operation: "replace",
            targetNodeId: "12:34",
          },
        ],
        strategy: {
          primaryFirst: true,
          creationOrder: ["state-filled"],
        },
      },
      figmaApplyLedger: {
        schemaVersion: "FigmaApplyLedger/v1",
        nodes: [
          {
            placementId: "state-filled",
            nodeId: "99:99",
            name: "Existing Events Frame - Filled",
            kind: "FRAME",
            bounds: { x: 100, y: 200, width: 1280, height: 720 },
          },
        ],
      },
    });

    expect(output.statePatch?.qaReport?.status).toBe("fail");
    expect(output.statePatch?.qaReport?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "replacement-target-node",
          severity: "error",
        }),
      ])
    );
  });
```

Modify `src/core/domain/ui-quality-gate.ts` so replacement placements are checked against the apply ledger:

```ts
if (placement.canvasOperation === "replace-target-frame") {
  const ledgerNode = ledgerNodesByPlacementId.get(placement.id);
  if (ledgerNode?.nodeId !== placement.targetNodeId) {
    findings.push({
      id: "replacement-target-node",
      severity: "error",
      message: `${placement.label} was applied to ${ledgerNode?.nodeId ?? "unknown"} instead of target ${placement.targetNodeId}`,
    });
  }
}
```

- [ ] **Step 9: Run canvas, draft, adapter, and QA tests**

Run:

```bash
bun test src/core/domain/test/canvas-plan.test.ts src/core/nodes/draft/test/draft-nodes.test.ts src/core/adapters/figma/test/apply-packet.test.ts src/core/nodes/qa/test/qa-nodes.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/core/schemas/artifact.ts src/core/domain/canvas-plan.ts src/core/domain/test/canvas-plan.test.ts src/core/domain/figma-transaction-plan.ts src/core/adapters/figma/apply-packet.ts src/core/nodes/draft/index.ts src/core/nodes/draft/test/draft-nodes.test.ts src/core/domain/ui-quality-gate.ts src/core/nodes/qa/test/qa-nodes.test.ts
git commit -m "feat(draft): support replacing existing target frames"
```

## Task 6: `refine-existing` Flow

**Files:**
- Create: `src/core/nodes/refine/index.ts`
- Create: `src/core/nodes/refine/test/refine-nodes.test.ts`
- Modify: `src/core/nodes/built-in-registry.ts`
- Create: `src/core/flows/built-in/refine-existing.flow.json`
- Modify: `src/core/flows/catalog.ts`
- Modify: `src/core/flows/test/catalog.test.ts`
- Modify: `src/core/nodes/test/built-in-node-registry.test.ts`
- Modify: `src/mcp/facade/test/resources.test.ts`
- Modify: `src/mcp/facade/test/tools.test.ts`

- [ ] **Step 1: Write failing refine node tests**

Create `src/core/nodes/refine/test/refine-nodes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";
import { refineNodeDefinitions } from "../index.js";

type NodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: {
    status: "waiting-for-user" | "waiting-for-figma";
    pendingQuestion?: { id: string; prompt: string; choices?: string[] };
  };
};

const baseState = (overrides: Partial<KotikitGraphState> = {}): KotikitGraphState => ({
  schemaVersion: "KotikitGraphState/v1",
  runId: "run-refine",
  flowId: "refine-existing",
  flowVersion: "1.0.0",
  graphHash: "graph-hash",
  status: "running",
  project: { root: "/tmp/project" },
  userIntent: "Refine the mocked Events page.",
  artifacts: [],
  errors: [],
  ...overrides,
});

async function runRefineNode(
  key: string,
  state: KotikitGraphState = baseState(),
  params: unknown = {}
): Promise<NodeOutput> {
  const node = refineNodeDefinitions.find((definition) => definition.key === key);
  if (node === undefined) throw new Error(`Missing node ${key}`);
  return (await node.run({ nodeId: key, params, state })) as NodeOutput;
}

describe("refine nodes", () => {
  it("promotes a single existing target to replace-existing-frame canvas intent", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frame",
          targets: [
            {
              nodeId: "12:34",
              screenId: "events",
              name: "Existing Events Frame",
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
            },
          ],
        },
      })
    );

    expect(output.interrupt).toBeUndefined();
    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:34", screenId: "events" },
    });
  });

  it("maps an explicit flow primary screen to its target", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        flowBlueprint: {
          schemaVersion: "FlowBlueprintInput/v1",
          title: "Mock Events Flow",
          primaryScreenId: "detail",
          screens: [
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "events",
              title: "Events Experience",
              requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
            },
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "detail",
              title: "Event Detail",
              requiredUiParts: [{ id: "summary", name: "Summary", role: "summary" }],
            },
          ],
        },
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frames",
          targets: [
            { nodeId: "12:34", screenId: "events", name: "Events" },
            { nodeId: "12:35", screenId: "detail", name: "Event Detail" },
          ],
        },
      })
    );

    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:35", screenId: "detail" },
    });
  });

  it("uses compact existing design inventory when direct canvas targets are missing", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        flowBlueprint: {
          schemaVersion: "FlowBlueprintInput/v1",
          title: "Mock Events Flow",
          primaryScreenId: "events",
          screens: [
            {
              schemaVersion: "ScreenBlueprintInput/v1",
              id: "events",
              title: "Events Experience",
              requiredUiParts: [{ id: "timeline", name: "Timeline", role: "timeline" }],
            },
          ],
        },
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "page",
          targets: [],
        },
        existingDesignInventory: {
          schemaVersion: "ExistingDesignInventoryInput/v1",
          source: "figma-scan",
          pageId: "page:1",
          pageName: "Mock Dashboard",
          targets: [
            {
              nodeId: "12:34",
              screenId: "events",
              name: "Existing Events Frame",
              kind: "frame",
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
            },
          ],
        },
      })
    );

    expect(output.statePatch?.canvasIntent).toMatchObject({
      mode: "replace-existing-frame",
      targetFrame: { nodeId: "12:34", screenId: "events" },
    });
  });

  it("asks for one clarification when multiple targets are ambiguous", async () => {
    const output = await runRefineNode(
      "refine.mapExistingTargets",
      baseState({
        canvasIntent: {
          mode: "refine-existing-targets",
          scope: "selected-frames",
          targets: [
            { nodeId: "12:34", name: "Frame A" },
            { nodeId: "12:35", name: "Frame B" },
          ],
        },
      })
    );

    expect(output.statePatch?.pendingQuestion).toMatchObject({
      id: "select-refine-target",
      choices: ["12:34", "12:35"],
    });
    expect(output.interrupt).toMatchObject({
      status: "waiting-for-user",
      pendingQuestion: { id: "select-refine-target" },
    });
  });
});
```

- [ ] **Step 2: Run refine node tests and verify they fail**

Run:

```bash
bun test src/core/nodes/refine/test/refine-nodes.test.ts
```

Expected: fail because refine nodes do not exist.

- [ ] **Step 3: Implement refine target mapping node**

Create `src/core/nodes/refine/index.ts`:

```ts
import { z } from "zod";
import { createUserInterrupt } from "../../graph/interrupts.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { CanvasIntentInput, ExistingDesignInventoryInput, FlowBlueprintInput } from "../../schemas/blueprint.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
  interrupt?: ReturnType<typeof createUserInterrupt>;
};

const EmptyParamsSchema = z.strictObject({});

export const refineNodeDefinitions: NodeDefinition[] = [
  node({
    key: "refine.mapExistingTargets",
    kind: "interrupt",
    stateReads: [
      "canvasIntent",
      "existingDesignInventory",
      "flowBlueprint",
      "screenBlueprint",
      "answers",
    ],
    stateWrites: ["canvasIntent", "pendingQuestion"],
    run: async (input) => {
      const state = input.state as KotikitGraphState;
      const intent = state.canvasIntent as CanvasIntentInput | undefined;
      if (intent?.mode !== "refine-existing-targets") return {} satisfies RuntimeNodeOutput;

      const selectedAnswer = state.answers?.["select-refine-target"];
      const targets = refineTargetsFrom(state, intent);
      const target =
        (selectedAnswer === undefined
          ? targetForBlueprint(targets, state.flowBlueprint as FlowBlueprintInput | undefined)
          : targets.find((candidate) => candidate.nodeId === selectedAnswer)) ??
        (targets.length === 1 ? targets[0] : undefined);

      if (target !== undefined) {
        return {
          statePatch: {
            canvasIntent: {
              mode: "replace-existing-frame",
              targetFrame: target,
            },
          },
        } satisfies RuntimeNodeOutput;
      }

      const pendingQuestion = {
        id: "select-refine-target",
        prompt: "Which existing frame should kotikit refine first?",
        choices: targets.map((candidate) => candidate.nodeId),
      };
      return {
        statePatch: { pendingQuestion },
        interrupt: createUserInterrupt(pendingQuestion),
      } satisfies RuntimeNodeOutput;
    },
  }),
];

function refineTargetsFrom(
  state: KotikitGraphState,
  intent: Extract<CanvasIntentInput, { mode: "refine-existing-targets" }>
): Extract<CanvasIntentInput, { mode: "refine-existing-targets" }>["targets"] {
  if (intent.targets.length > 0) return intent.targets;

  const inventory = state.existingDesignInventory as ExistingDesignInventoryInput | undefined;
  return (
    inventory?.targets.map((target) => ({
      nodeId: target.nodeId,
      ...(target.screenId === undefined ? {} : { screenId: target.screenId }),
      name: target.name,
      ...(target.bounds === undefined ? {} : { bounds: target.bounds }),
    })) ?? []
  );
}

function targetForBlueprint(
  targets: Extract<CanvasIntentInput, { mode: "refine-existing-targets" }>["targets"],
  flowBlueprint: FlowBlueprintInput | undefined
): (typeof targets)[number] | undefined {
  const screenId = flowBlueprint?.primaryScreenId ?? flowBlueprint?.entryScreenId;
  if (screenId === undefined) return undefined;
  return targets.find((target) => target.screenId === screenId);
}

function node(
  input: Partial<NodeDefinition> & Pick<NodeDefinition, "key" | "run">
): NodeDefinition {
  return {
    key: input.key,
    version: "1.0.0",
    kind: input.kind ?? "deterministic",
    paramsSchema: input.paramsSchema ?? EmptyParamsSchema,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    stateReads: input.stateReads ?? [],
    stateWrites: input.stateWrites ?? [],
    sideEffects: input.sideEffects ?? "none",
    requiredCapabilities: input.requiredCapabilities ?? [],
    run: input.run,
  };
}
```

- [ ] **Step 4: Register refine nodes**

Modify `src/core/nodes/built-in-registry.ts`:

```ts
import { refineNodeDefinitions } from "./refine/index.js";
```

Add to `builtInNodeDefinitions()` after `feedbackNodeDefinitions`:

```ts
    ...refineNodeDefinitions,
```

- [ ] **Step 5: Add built-in flow manifest**

Create `src/core/flows/built-in/refine-existing.flow.json`:

```json
{
  "schemaVersion": 1,
  "id": "refine-existing",
  "version": "1.0.0",
  "title": "Refine Existing",
  "description": "Refine one existing Figma frame from explicit target context, blueprint intent, and local design-system evidence.",
  "stateSchema": "KotikitGraphState/v1",
  "requiredCapabilities": [
    "brief.write",
    "ux.brainstorm",
    "ux.plan",
    "designSystem.search.local",
    "designSystem.fit",
    "figma.target",
    "draft.compile",
    "figma.write.remote",
    "qa.run"
  ],
  "nodes": [
    { "id": "map-existing-targets", "uses": "refine.mapExistingTargets", "params": {} },
    { "id": "classify-intent", "uses": "brief.classifyIntent", "params": { "lanes": ["quick", "guided", "deep"] } },
    { "id": "capture-minimal-intent", "uses": "brief.captureMinimalIntent", "params": { "lane": "adaptive" } },
    { "id": "infer-screen-blueprint", "uses": "brief.inferScreenBlueprint", "params": {} },
    { "id": "brainstorm-design-approach", "uses": "ux.brainstormApproach", "params": {} },
    { "id": "build-ux-envelope", "uses": "ux.buildEnvelope", "params": {} },
    { "id": "plan-state-matrix", "uses": "ux.planStateMatrix", "params": {} },
    { "id": "summarize-brief-for-approval", "uses": "brief.summarizeForApproval", "params": {} },
    { "id": "ask-brief-approval", "uses": "brief.askApproval", "params": {} },
    { "id": "save-approved-brief", "uses": "brief.saveApproved", "params": {} },
    { "id": "search-local-design-system", "uses": "designSystem.searchLocal", "params": {} },
    { "id": "build-fit-report", "uses": "designSystem.buildFitReport", "params": {} },
    { "id": "save-reuse-plan", "uses": "designSystem.saveReusePlan", "params": {} },
    { "id": "ensure-draft-target", "uses": "figma.ensureDraftTarget", "params": {} },
    { "id": "build-canvas-plan", "uses": "draft.buildCanvasPlan", "params": {} },
    { "id": "build-ui-composition-contract", "uses": "ui.buildCompositionContract", "params": {} },
    { "id": "build-state-representation-contract", "uses": "ui.buildStateRepresentationContract", "params": {} },
    { "id": "build-layout-contract", "uses": "ui.buildLayoutContract", "params": {} },
    { "id": "build-variable-binding-plan", "uses": "ui.buildVariableBindingPlan", "params": {} },
    { "id": "validate-no-hardcoded-imitation", "uses": "ui.validateNoHardcodedImitation", "params": {} },
    { "id": "compile-high-fidelity-draft", "uses": "draft.compileHighFidelityDraft", "params": {} },
    { "id": "build-figma-transaction-plan", "uses": "draft.buildFigmaTransactionPlan", "params": {} },
    { "id": "build-figma-apply-packet", "uses": "draft.buildFigmaApplyPacket", "params": {} },
    { "id": "apply-figma-transaction-queue", "uses": "figma.applyTransactionQueue", "params": {} },
    { "id": "verify-draft-invariants", "uses": "figma.verifyDraftInvariants", "params": {} },
    { "id": "verify-state-representation", "uses": "ui.verifyStateRepresentation", "params": {} },
    { "id": "save-apply-report", "uses": "figma.saveApplyReport", "params": {} },
    { "id": "run-ui-quality-gate", "uses": "qa.runUiQualityGate", "params": {} },
    { "id": "post-draft-qa", "uses": "qa.postDraftQa", "params": {} },
    { "id": "save-design-system-usage-report", "uses": "designSystem.saveUsageReport", "params": {} }
  ],
  "edges": [
    ["map-existing-targets", "classify-intent"],
    ["classify-intent", "capture-minimal-intent"],
    ["capture-minimal-intent", "infer-screen-blueprint"],
    ["infer-screen-blueprint", "brainstorm-design-approach"],
    ["brainstorm-design-approach", "build-ux-envelope"],
    ["build-ux-envelope", "plan-state-matrix"],
    ["plan-state-matrix", "summarize-brief-for-approval"],
    ["summarize-brief-for-approval", "ask-brief-approval"],
    ["ask-brief-approval", "save-approved-brief"],
    ["save-approved-brief", "search-local-design-system"],
    ["search-local-design-system", "build-fit-report"],
    ["build-fit-report", "save-reuse-plan"],
    ["save-reuse-plan", "ensure-draft-target"],
    ["ensure-draft-target", "build-canvas-plan"],
    ["build-canvas-plan", "build-ui-composition-contract"],
    ["build-ui-composition-contract", "build-state-representation-contract"],
    ["build-state-representation-contract", "build-layout-contract"],
    ["build-layout-contract", "build-variable-binding-plan"],
    ["build-variable-binding-plan", "validate-no-hardcoded-imitation"],
    ["validate-no-hardcoded-imitation", "compile-high-fidelity-draft"],
    ["compile-high-fidelity-draft", "build-figma-transaction-plan"],
    ["build-figma-transaction-plan", "build-figma-apply-packet"],
    ["build-figma-apply-packet", "apply-figma-transaction-queue"],
    ["apply-figma-transaction-queue", "verify-draft-invariants"],
    ["verify-draft-invariants", "verify-state-representation"],
    ["verify-state-representation", "save-apply-report"],
    ["save-apply-report", "run-ui-quality-gate"],
    ["run-ui-quality-gate", "post-draft-qa"],
    ["post-draft-qa", "save-design-system-usage-report"]
  ],
  "start": "map-existing-targets",
  "end": ["save-design-system-usage-report"],
  "safetyProfile": "standard-design-draft"
}
```

- [ ] **Step 6: Load the new built-in flow**

Modify `src/core/flows/catalog.ts`:

```ts
const BUILT_IN_FLOW_FILES = [
  "create-screen.flow.json",
  "refine-existing.flow.json",
  "review-screen.flow.json",
];
```

- [ ] **Step 7: Update built-in flow expectations**

Modify `src/core/flows/test/catalog.test.ts`:

```ts
const BUILT_IN_FLOW_IDS = ["create-screen", "refine-existing", "review-screen"];
```

Add test:

```ts
  it("refine-existing starts from explicit target mapping", async () => {
    const refineExisting = requireFlow(await loadBuiltInFlows(), "refine-existing");

    expect(refineExisting.nodes.map((node) => node.uses)[0]).toBe("refine.mapExistingTargets");
    expect(refineExisting.requiredCapabilities).toContain("figma.write.remote");
  });
```

Modify `src/core/nodes/test/built-in-node-registry.test.ts` stale optional flow test:

```ts
    expect(flows.map((flow) => flow.id)).toEqual([
      "create-screen",
      "refine-existing",
      "review-screen",
    ]);
```

Modify `src/mcp/facade/test/tools.test.ts` built-in list expectation:

```ts
    expect(detail.flows.map((flow) => flow.id)).toEqual([
      "create-screen",
      "refine-existing",
      "review-screen",
    ]);
```

Modify `src/mcp/facade/test/resources.test.ts` completions:

```ts
  it("completes the refine existing flow id", async () => {
    const result = await completeFacadeArgument({
      ref: { type: "ref/prompt", name: "kotikit.create_screen" },
      argument: { name: "flowId", value: "refine" },
    });

    expect(result.completion.values).toEqual(["refine-existing"]);
    expect(result.completion.total).toBe(1);
  });
```

- [ ] **Step 8: Run flow and refine tests**

Run:

```bash
bun test src/core/nodes/refine/test/refine-nodes.test.ts src/core/flows/test/catalog.test.ts src/core/nodes/test/built-in-node-registry.test.ts src/mcp/facade/test/tools.test.ts src/mcp/facade/test/resources.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/nodes/refine src/core/nodes/built-in-registry.ts src/core/flows/built-in/refine-existing.flow.json src/core/flows/catalog.ts src/core/flows/test/catalog.test.ts src/core/nodes/test/built-in-node-registry.test.ts src/mcp/facade/test/resources.test.ts src/mcp/facade/test/tools.test.ts
git commit -m "feat(flow): add refine existing graph flow"
```

## Task 7: Graph Smoke Tests And Docs

**Files:**
- Modify: `e2e/graph/create-screen-flow.test.ts`
- Create: `e2e/graph/refine-existing-flow.test.ts`
- Modify: `docs/tools.md`
- Modify: `.agents/skills/kotikit-auto/SKILL.md`

- [ ] **Step 1: Add create-screen blueprint smoke test**

Add to `e2e/graph/create-screen-flow.test.ts`:

```ts
  it("preserves blueprint title and semantic parts through create-screen", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-blueprint-screen-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "create-screen",
        input: {
          project: { root, name: "Mock Blueprint Project" },
          userIntent: "Create the supplied mocked Events Experience PRD.",
          figmaTarget: fakeDraftTarget("Draft - Events"),
          screenBlueprint: {
            schemaVersion: "ScreenBlueprintInput/v1",
            title: "Events Experience",
            productDomain: "Mock Operations",
            requiredUiParts: [
              {
                id: "event-stream",
                name: "Event stream",
                role: "timeline",
                variableRoles: [{ property: "text", semanticRole: "timeline label" }],
              },
              { id: "detail-panel", name: "Detail panel", role: "context panel" },
            ],
          },
        },
      });

      expect(started.state.screen).toMatchObject({
        title: "Events Experience",
        requiredUiParts: ["Event stream", "Detail panel"],
      });
      expect(started.state.uiComposition?.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "event-stream", role: "timeline" }),
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Add refine-existing smoke test**

Create `e2e/graph/refine-existing-flow.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphSmokeFixture,
  fakeDraftTarget,
  seedLocalDesignSystem,
} from "./fixtures/fake-figma.js";

describe("refine-existing graph flow", () => {
  it("starts from compact existing design inventory and creates replacement metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kotikit-e2e-refine-existing-"));
    try {
      seedLocalDesignSystem(root, { includePrimaryAction: false });
      const { runtime } = await createGraphSmokeFixture(root);

      const started = await runtime.startFlow({
        flowId: "refine-existing",
        input: {
          project: { root, name: "Mock Existing Project" },
          userIntent: "Refine the mocked Events frame using the supplied blueprint.",
          figmaTarget: fakeDraftTarget("Draft - Existing Events"),
          screenBlueprint: {
            schemaVersion: "ScreenBlueprintInput/v1",
            title: "Events Experience",
            requiredUiParts: [
              { id: "event-stream", name: "Event stream", role: "timeline" },
              { id: "detail-panel", name: "Detail panel", role: "context panel" },
            ],
          },
          canvasIntent: {
            mode: "refine-existing-targets",
            scope: "page",
            targets: [],
          },
          existingDesignInventory: {
            schemaVersion: "ExistingDesignInventoryInput/v1",
            source: "figma-scan",
            pageId: "page:1",
            pageName: "Mock Existing Dashboard",
            targets: [
              {
                nodeId: "12:34",
                screenId: "events",
                name: "Existing Events Frame",
                kind: "frame",
                bounds: { x: 0, y: 0, width: 1280, height: 720 },
              },
            ],
          },
        },
      });

      expect(started.state.canvasIntent).toMatchObject({
        mode: "replace-existing-frame",
        targetFrame: { nodeId: "12:34" },
      });
      expect(started.state.canvasPlan).toMatchObject({
        placements: [expect.objectContaining({ operation: "replace", targetNodeId: "12:34" })],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Update docs**

Modify `docs/tools.md` `kotikit_start` input line:

```md
Input: `{ flowId: string; input?: { userIntent?: string; screenBlueprint?: object; flowBlueprint?: object; canvasIntent?: object; existingDesignInventory?: object; figmaTarget?: object; designSystem?: object; feedback?: object; project?: { root: string; name?: string } } }`
```

Add after `kotikit_start`:

```md
For detailed PRDs, assistants should pass `screenBlueprint` or `flowBlueprint`
instead of relying on plain-language inference. Kotikit preserves blueprint
titles, product domains, screen names, UI parts, regions, repeated patterns,
and canvas intent. Without a blueprint, fallback inference is intentionally
limited to short simple prompts.

Graph execution uses kotikit's local design-system cache as the source of
truth for reusable components, icons, and variables. Do not rely on open-ended
Figma design-system search during a run; if local design-system data is
missing, sync or update the local cache before requesting production-quality
output.
```

Add a flow entry:

```md
### refine-existing

Purpose: Refine existing Figma frames or pages from explicit target context.
Use this flow when the designer wants kotikit to modify selected frames or an
existing page instead of drafting a new section. Pass `canvasIntent` with
`mode: "refine-existing-targets"` and target frame refs. For pages with several
screens or designs not created by kotikit, pass `existingDesignInventory` with
compact frame metadata from the selected page or Figma scan. When multiple
targets are ambiguous, kotikit asks one clarification instead of guessing.
```

- [ ] **Step 4: Update kotikit auto skill**

Modify `.agents/skills/kotikit-auto/SKILL.md`:

Add to Required Behavior:

```md
- For detailed PRDs, first translate the designer request into a structured
  `screenBlueprint` or `flowBlueprint`; do not rely on `userIntent` alone.
- Use `refine-existing` when the designer asks to modify existing Figma frames,
  selected screens, or a page that already contains screens.
- For existing Figma pages, pass compact `existingDesignInventory` from the
  selected page or frames so kotikit can target the intended node without
  requiring the screen to have been created by kotikit.
- Use kotikit's local design-system cache for component, icon, and variable
  choices. Do not call open-ended Figma design-system search as part of graph
  execution; ask to sync/update the local cache when required data is missing.
```

Modify Create Or Refine Design step 3:

```md
3. Call `kotikit_start` with the chosen flow, `userIntent`, and a blueprint for
   detailed PRDs. Use `create-screen` for new drafts and `refine-existing` with
   `canvasIntent` plus `existingDesignInventory` for existing Figma targets.
```

- [ ] **Step 5: Run graph and docs-adjacent tests**

Run:

```bash
bun test e2e/graph/create-screen-flow.test.ts e2e/graph/refine-existing-flow.test.ts src/docs/test/ux-quality-docs.test.ts src/test/tooling-config.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/graph/create-screen-flow.test.ts e2e/graph/refine-existing-flow.test.ts docs/tools.md .agents/skills/kotikit-auto/SKILL.md
git commit -m "docs(workflow): document blueprint refine flows"
```

## Task 8: Final Quality Gate

**Files:**
- No new files.
- Verify the complete change set.

- [ ] **Step 1: Run focused behavior tests**

Run:

```bash
bun test src/core/schemas/test/blueprint.test.ts src/core/nodes/brief/test/brief-nodes.test.ts src/core/domain/test/ux-envelope.test.ts src/core/nodes/design-system/test/design-system-nodes.test.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/domain/test/canvas-plan.test.ts src/core/nodes/draft/test/draft-nodes.test.ts src/core/adapters/figma/test/apply-packet.test.ts src/core/nodes/qa/test/qa-nodes.test.ts src/core/nodes/refine/test/refine-nodes.test.ts src/core/flows/test/catalog.test.ts e2e/graph/create-screen-flow.test.ts e2e/graph/refine-existing-flow.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run repo check**

Run:

```bash
bun run check
```

Expected: Biome and cspell pass.

- [ ] **Step 3: Run full tests if focused tests and check pass**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are modified; no unrelated changes such as `figma-plugin/manifest.json` appear.

- [ ] **Step 5: Final commit if needed**

If a quality-gate fix changed files, commit it:

```bash
git add src/core/schemas/blueprint.ts src/core/schemas/test/blueprint.test.ts src/core/schemas/graph-state.ts src/core/graph/runtime.ts src/mcp/facade/tools.ts src/mcp/facade/test/tools.test.ts src/core/nodes/brief/index.ts src/core/nodes/brief/test/brief-nodes.test.ts src/core/domain/ux-envelope.ts src/core/domain/test/ux-envelope.test.ts src/core/nodes/ux/index.ts src/core/nodes/design-system/index.ts src/core/nodes/design-system/test/design-system-nodes.test.ts src/core/schemas/artifact.ts src/core/domain/ui-composition-contract.ts src/core/domain/variable-binding-plan.ts src/core/nodes/ui-composition/index.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/domain/canvas-plan.ts src/core/domain/test/canvas-plan.test.ts src/core/domain/figma-transaction-plan.ts src/core/adapters/figma/apply-packet.ts src/core/nodes/draft/index.ts src/core/nodes/draft/test/draft-nodes.test.ts src/core/domain/ui-quality-gate.ts src/core/nodes/qa/test/qa-nodes.test.ts src/core/nodes/refine src/core/nodes/built-in-registry.ts src/core/flows/built-in/refine-existing.flow.json src/core/flows/catalog.ts src/core/flows/test/catalog.test.ts src/core/nodes/test/built-in-node-registry.test.ts src/mcp/facade/test/resources.test.ts e2e/graph/create-screen-flow.test.ts e2e/graph/refine-existing-flow.test.ts docs/tools.md .agents/skills/kotikit-auto/SKILL.md
git commit -m "test(core): cover blueprint refine intent flow"
```

If no files changed during the quality gate, no final commit is needed.

## Self-Review Notes

- Spec coverage: blueprint contracts, fallback behavior, composable traits, explicit pattern refs, semantic variable roles, canvas replacement, `refine-existing`, docs, and tests are each mapped to a task.
- No real customer or company data is used. Examples use mocked Events, Mock Operations, and generic frame names.
- No new built-in archetype enum values are added. Unknown/custom product intent stays valid through blueprint traits and explicit UI parts.
- Fallback still supports explicit short "members table" style prompts without using broad detailed-PRD keyword classification.
- The plan intentionally does not require multi-screen Figma writes in the first `create-screen` slice. It preserves full `flowBlueprint` and drafts the primary screen first.
