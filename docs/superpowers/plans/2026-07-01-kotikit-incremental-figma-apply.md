# Kotikit Incremental Figma Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kotikit create Figma designs incrementally, with deterministic canvas placement, durable node mapping, and QA gates that prevent overlapping, hardcoded, or messy generated work.

**Architecture:** Keep LangGraph as the reliability boundary and add a small incremental Figma transaction layer between the current draft contracts and official Figma writes. The graph will build a `CanvasPlan`, drain a `FigmaTransactionPlan` transaction-by-transaction through repeated `waiting-for-figma` interrupts, record a `FigmaNodeLedger`, reconcile moved nodes before comment review, and run placement-aware QA before declaring the draft usable.

**Tech Stack:** Bun, TypeScript strict mode, Zod v4, existing LangGraphJS runtime wrapper, existing official Figma MCP write path, local design-system SQLite search, kotikit artifact/run stores.

---

## Global Rules For Every Agent

- Work in the current branch unless the user explicitly asks for a new branch.
- Read `AGENTS.md` and `docs/coding_guidelines.md` before editing code.
- Use Bun for runtime, tests, and scripts.
- Follow TDD for every behavior change: write the focused failing test first, run it red, implement the smallest change, run it green.
- Keep core modules agent-neutral. Codex, Claude Code, and future assistants must share the same graph contracts and MCP tools.
- Do not hardcode the admin members screen into core logic. Put archetype-specific layout decisions in typed pattern packs or small generic domain policies.
- Preserve context durability. New graph behavior must resume from persisted run state and artifacts without relying on conversation history.
- Keep graph state compact. Store large raw Figma snapshots, current node scans, and comments as artifacts after compact ledgers/maps exist.
- Update live docs with every user-facing behavior change.
- Remove stale code once replacement graph-backed paths are tested.
- Stage only files changed by the current task.
- Make atomic Conventional Commits after each task.

## Product Rules For Designers

- Designers should be able to ask in plain language, for example `Create admin members page`, and get a clean Figma canvas without learning graph internals.
- Kotikit must create component-by-component or screen-by-screen. It must not ask the assistant to dump every screen state in one opaque Figma write.
- Each generated frame, component, or layer must be placed in a deterministic area that cannot overlap already created kotikit nodes.
- Each meaningful UI part must come from an existing design-system component, an approved draft component, or an explicit approved primitive exception.
- Screens must use auto layout, design-system components, and variables/styles where available.
- Placement inside screens must be intentional and context-aware: navigation left for admin shells, actions near task flow, empty/error messages in the affected region, destructive or permission states centered where the user's attention belongs.
- Designers may move, rename, duplicate, or comment on generated frames. Kotikit must reconcile current Figma nodes before comment review instead of assuming the original canvas stayed untouched.
- Blocked states must be designer-readable: one problem, why it matters, and one recommended next action.

## Recommended Agent Split

- Agent A: canvas and placement schemas/domain.
- Agent B: incremental transaction queue, runtime interrupt behavior, and Figma nodes.
- Agent C: MCP apply metadata surface and fake Figma fixtures.
- Agent D: comment reconciliation and evidence map upgrade.
- Agent E: QA gates, graph flow updates, and end-to-end tests.
- Agent F: docs, skills, cleanup, full verification, and final review.

Agents A and C can start in parallel. Agent B depends on Agent A. Agent D depends on Agent A and C. Agent E depends on A through D. Agent F runs last.

## File Map

Create:

- `src/core/domain/canvas-plan.ts`
- `src/core/domain/figma-transaction-plan.ts`
- `src/core/domain/canvas-reconciliation.ts`
- `src/core/domain/test/canvas-plan.test.ts`
- `src/core/domain/test/figma-transaction-plan.test.ts`
- `src/core/domain/test/canvas-reconciliation.test.ts`
- `src/core/graph/test/figma-transaction-interrupt.test.ts`

Modify:

- `src/core/schemas/artifact.ts`
- `src/core/schemas/graph-state.ts`
- `src/core/graph/interrupts.ts`
- `src/core/graph/runtime.ts`
- `src/core/nodes/draft/index.ts`
- `src/core/nodes/figma/index.ts`
- `src/core/nodes/figma/test/figma-nodes.test.ts`
- `src/core/nodes/ui-composition/index.ts`
- `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
- `src/core/nodes/comments/index.ts`
- `src/core/nodes/comments/test/comments-nodes.test.ts`
- `src/core/nodes/qa/index.ts`
- `src/core/nodes/qa/test/qa-nodes.test.ts`
- `src/core/nodes/built-in-registry.ts`
- `src/core/flows/built-in/create-screen.flow.json`
- `src/core/flows/built-in/review-comments.flow.json`
- `src/core/adapters/figma/apply-packet.ts`
- `src/mcp/facade/tools.ts`
- `src/mcp/facade/test/tools.test.ts`
- `src/mcp/instructions.ts`
- `src/mcp/facade/prompts.ts`
- `e2e/graph/fixtures/fake-figma.ts`
- `e2e/graph/create-screen-flow.test.ts`
- `e2e/graph/review-comments-flow.test.ts`
- `.agents/skills/kotikit-auto/SKILL.md`
- `.agents/skills/kotikit-design-review/SKILL.md`
- `plugins/codex/kotikit/skills/kotikit/SKILL.md`
- `plugins/claude/kotikit/skills/kotikit/SKILL.md`
- `README.md`
- `docs/workflows.md`
- `docs/figma.md`
- `docs/tools.md`
- `docs/modules/mcp.md`
- `docs/modules/workflow.md`
- `docs/troubleshooting.md`
- `KOTIKIT_MIGRATION.md`

Potential cleanup after replacement coverage exists:

- Remove the no-op `draft.draftScreensIncrementally` node if no flow uses it.
- Remove stale one-shot Figma apply guidance from docs, skills, prompts, and MCP instructions.
- Remove stale tests that encourage one-shot state dumping.

---

## Task 1: Add Canvas And Ledger Artifact Schemas

**Files:**

- Modify: `src/core/schemas/artifact.ts`
- Modify: `src/core/schemas/graph-state.ts`
- Create: `src/core/domain/test/canvas-plan.test.ts`

- [ ] **Step 1: Read required guidelines**

Run:

```bash
sed -n '1,220p' AGENTS.md
sed -n '1,260p' docs/coding_guidelines.md
```

Expected: both files are readable and confirm Bun, TDD, docs updates, and atomic Conventional Commits.

- [ ] **Step 2: Write failing schema tests**

Create `src/core/domain/test/canvas-plan.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  CanvasPlanSchema,
  FigmaNodeLedgerSchema,
  FigmaTransactionPlanSchema,
} from "../../schemas/artifact.js";
import { KotikitGraphStateSchema } from "../../schemas/graph-state.js";

describe("incremental Figma canvas contracts", () => {
  it("accepts a canvas plan with non-overlapping named zones", () => {
    const plan = CanvasPlanSchema.parse({
      schemaVersion: "CanvasPlan/v1",
      section: { id: "section-1", name: "kotikit / members / 2026-07-01" },
      coordinateSpace: "section-relative",
      screenSize: { width: 1440, height: 900 },
      minGap: 160,
      zones: [
        {
          id: "zone-draft-components",
          kind: "draft-components",
          label: "Draft components",
          bounds: { x: 0, y: 0, width: 360, height: 900 },
        },
        {
          id: "zone-screen-states",
          kind: "screen-states",
          label: "Screen states",
          bounds: { x: 560, y: 0, width: 3040, height: 1960 },
        },
      ],
      placements: [
        {
          id: "state-filled",
          kind: "screen-state",
          stateId: "filled",
          label: "Members / Filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          parentZoneId: "zone-screen-states",
          transactionId: "txn-state-filled",
        },
        {
          id: "state-loading",
          kind: "screen-state",
          stateId: "loading",
          label: "Members / Loading",
          bounds: { x: 2160, y: 0, width: 1440, height: 900 },
          parentZoneId: "zone-screen-states",
          transactionId: "txn-state-loading",
        },
      ],
      strategy: {
        primaryFirst: true,
        creationOrder: ["state-filled", "state-loading"],
        designerNotes: [
          "Create the filled state first so the designer has an immediate review target.",
        ],
      },
    });

    expect(plan.strategy.creationOrder).toEqual(["state-filled", "state-loading"]);
  });

  it("accepts an ordered transaction plan and node ledger", () => {
    const transactionPlan = FigmaTransactionPlanSchema.parse({
      schemaVersion: "FigmaTransactionPlan/v1",
      mode: "incremental-official-figma-mcp",
      transactions: [
        {
          id: "txn-state-filled",
          order: 1,
          kind: "create-screen-state",
          label: "Members / Filled",
          placementId: "state-filled",
          stateId: "filled",
          status: "pending",
          requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs"],
        },
      ],
    });
    const ledger = FigmaNodeLedgerSchema.parse({
      schemaVersion: "FigmaNodeLedger/v1",
      fileKey: "FILE",
      pageId: "1:2",
      sectionName: "kotikit / members / 2026-07-01",
      nodes: [
        {
          nodeId: "9:10",
          name: "Members / Filled",
          kind: "FRAME",
          semanticRole: "screen-state",
          transactionId: "txn-state-filled",
          placementId: "state-filled",
          stateId: "filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          componentRefs: ["button-primary-key"],
          variableRefs: ["var-color-primary"],
          autoLayout: true,
          recordedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(transactionPlan.transactions[0]?.status).toBe("pending");
    expect(ledger.nodes[0]?.semanticRole).toBe("screen-state");
  });

  it("allows graph state to persist compact canvas and transaction refs", () => {
    const state = KotikitGraphStateSchema.parse({
      schemaVersion: "KotikitGraphState/v1",
      runId: "run-1",
      flowId: "create-screen",
      flowVersion: "1.0.0",
      graphHash: "hash",
      status: "running",
      project: { root: "/tmp/project" },
      canvasPlan: {
        schemaVersion: "CanvasPlan/v1",
        section: { name: "kotikit / members / 2026-07-01" },
        coordinateSpace: "section-relative",
        screenSize: { width: 1440, height: 900 },
        minGap: 160,
        zones: [],
        placements: [],
        strategy: { primaryFirst: true, creationOrder: [], designerNotes: [] },
      },
      figmaTransactionPlan: {
        schemaVersion: "FigmaTransactionPlan/v1",
        mode: "incremental-official-figma-mcp",
        transactions: [],
      },
      artifacts: [],
      errors: [],
    });

    expect(state.canvasPlan?.schemaVersion).toBe("CanvasPlan/v1");
  });
});
```

- [ ] **Step 3: Run tests to verify red**

Run:

```bash
bun test src/core/domain/test/canvas-plan.test.ts
```

Expected: FAIL because `CanvasPlanSchema`, `FigmaTransactionPlanSchema`, `FigmaNodeLedgerSchema`, and graph state fields do not exist.

- [ ] **Step 4: Add schemas**

Modify `src/core/schemas/artifact.ts`:

```ts
export const BoundsSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const CanvasPlanSchema = z.strictObject({
  schemaVersion: z.literal("CanvasPlan/v1"),
  section: z.strictObject({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
  }),
  coordinateSpace: z.literal("section-relative"),
  screenSize: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  minGap: z.number().nonnegative(),
  zones: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: z.enum(["draft-components", "screen-states", "review-notes"]),
      label: z.string().min(1),
      bounds: BoundsSchema,
    })
  ),
  placements: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: z.enum(["screen-state", "draft-component", "annotation"]),
      stateId: z.string().min(1).optional(),
      draftComponentId: z.string().min(1).optional(),
      label: z.string().min(1),
      bounds: BoundsSchema,
      parentZoneId: z.string().min(1),
      transactionId: z.string().min(1),
    })
  ),
  strategy: z.strictObject({
    primaryFirst: z.boolean(),
    creationOrder: z.array(z.string().min(1)),
    designerNotes: z.array(z.string().min(1)),
  }),
});

export const FigmaTransactionPlanSchema = z.strictObject({
  schemaVersion: z.literal("FigmaTransactionPlan/v1"),
  mode: z.literal("incremental-official-figma-mcp"),
  transactions: z.array(
    z.strictObject({
      id: z.string().min(1),
      order: z.number().int().positive(),
      kind: z.enum([
        "create-draft-component",
        "create-screen-state",
        "create-region-state",
        "verify-created-node",
      ]),
      label: z.string().min(1),
      placementId: z.string().min(1),
      stateId: z.string().min(1).optional(),
      draftComponentId: z.string().min(1).optional(),
      status: z.enum(["pending", "active", "recorded", "failed"]),
      requiredMetadata: z.array(
        z.enum(["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"])
      ),
    })
  ),
});

export const FigmaNodeLedgerSchema = z.strictObject({
  schemaVersion: z.literal("FigmaNodeLedger/v1"),
  fileKey: z.string().min(1),
  pageId: z.string().min(1),
  sectionName: z.string().min(1),
  nodes: z.array(
    z.strictObject({
      nodeId: z.string().min(1),
      name: z.string().min(1),
      kind: z.string().min(1),
      semanticRole: z.enum([
        "screen-state",
        "draft-component",
        "component-instance",
        "layout-frame",
        "annotation",
      ]),
      transactionId: z.string().min(1),
      placementId: z.string().min(1),
      stateId: z.string().min(1).optional(),
      draftComponentId: z.string().min(1).optional(),
      partId: z.string().min(1).optional(),
      bounds: BoundsSchema,
      componentRefs: z.array(z.string().min(1)),
      variableRefs: z.array(z.string().min(1)),
      autoLayout: z.boolean(),
      recordedAt: z.string().min(1),
    })
  ),
  updatedAt: z.string().min(1),
});

export const CanvasReconciliationReportSchema = z.strictObject({
  schemaVersion: z.literal("CanvasReconciliationReport/v1"),
  fileKey: z.string().min(1),
  pageId: z.string().min(1),
  reconciledAt: z.string().min(1),
  nodes: z.array(
    z.strictObject({
      nodeId: z.string().min(1),
      ledgerStatus: z.enum(["matched", "moved", "renamed", "missing", "untracked"]),
      previousBounds: BoundsSchema.optional(),
      currentBounds: BoundsSchema.optional(),
      previousName: z.string().min(1).optional(),
      currentName: z.string().min(1).optional(),
      transactionId: z.string().min(1).optional(),
      placementId: z.string().min(1).optional(),
      stateId: z.string().min(1).optional(),
    })
  ),
  unmappedCommentsRisk: z.enum(["none", "low", "needs-human"]),
});
```

Add artifact types and versions:

```ts
"canvas-plan",
"figma-transaction-plan",
"figma-node-ledger",
"canvas-reconciliation-report",
```

```ts
"canvas-plan": "CanvasPlan/v1",
"figma-transaction-plan": "FigmaTransactionPlan/v1",
"figma-node-ledger": "FigmaNodeLedger/v1",
"canvas-reconciliation-report": "CanvasReconciliationReport/v1",
```

Add the new schemas to `ArtifactPayloadSchema`.

Modify `src/core/schemas/graph-state.ts` imports and state fields:

```ts
  CanvasPlanSchema,
  CanvasReconciliationReportSchema,
  FigmaNodeLedgerSchema,
  FigmaTransactionPlanSchema,
```

```ts
  canvasPlan: CanvasPlanSchema.optional(),
  figmaTransactionPlan: FigmaTransactionPlanSchema.optional(),
  activeFigmaTransaction: z.unknown().optional(),
  figmaNodeLedger: FigmaNodeLedgerSchema.optional(),
  canvasReconciliation: CanvasReconciliationReportSchema.optional(),
```

- [ ] **Step 5: Run schema tests green**

Run:

```bash
bun test src/core/domain/test/canvas-plan.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/schemas/artifact.ts src/core/schemas/graph-state.ts src/core/domain/test/canvas-plan.test.ts
git commit -m "feat(core): add incremental figma canvas contracts"
```

---

## Task 2: Build Deterministic Canvas Placement

**Files:**

- Create: `src/core/domain/canvas-plan.ts`
- Modify: `src/core/domain/test/canvas-plan.test.ts`
- Modify: `src/core/nodes/ui-composition/index.ts`
- Modify: `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`

- [ ] **Step 1: Add failing canvas placement tests**

Append to `src/core/domain/test/canvas-plan.test.ts`:

```ts
import {
  buildCanvasPlan,
  placementsOverlap,
  verifyCanvasPlan,
} from "../canvas-plan.js";

describe("buildCanvasPlan", () => {
  it("places draft components and screen states in separate non-overlapping zones", () => {
    const plan = buildCanvasPlan({
      sectionName: "kotikit / members / 2026-07-01",
      screenTitle: "Members",
      screenSize: { width: 1440, height: 900 },
      states: [
        { id: "filled", label: "Filled", kind: "filled" },
        { id: "loading", label: "Loading", kind: "loading" },
        { id: "empty", label: "Empty", kind: "empty" },
        { id: "error", label: "Error", kind: "error" },
        { id: "permission", label: "Permission", kind: "permission" },
      ],
      draftComponents: [{ id: "draft-table-row", name: "Draft/Table Row" }],
    });

    expect(plan.strategy.creationOrder).toEqual([
      "draft-draft-table-row",
      "state-filled",
      "state-loading",
      "state-empty",
      "state-error",
      "state-permission",
    ]);
    expect(() => verifyCanvasPlan(plan)).not.toThrow();
    expect(
      plan.placements.some((left, index) =>
        plan.placements.slice(index + 1).some((right) => placementsOverlap(left, right, plan.minGap))
      )
    ).toBe(false);
  });

  it("keeps table-region states same-sized and in a predictable grid", () => {
    const plan = buildCanvasPlan({
      sectionName: "kotikit / members / 2026-07-01",
      screenTitle: "Members table",
      screenSize: { width: 1280, height: 800 },
      states: [
        { id: "filled", label: "Filled", kind: "filled" },
        { id: "loading", label: "Loading", kind: "loading" },
        { id: "no-results", label: "No results", kind: "no-results" },
        { id: "error", label: "Error", kind: "error" },
      ],
      draftComponents: [],
    });

    const statePlacements = plan.placements.filter((placement) => placement.kind === "screen-state");
    expect(new Set(statePlacements.map((placement) => placement.bounds.width))).toEqual(
      new Set([1280])
    );
    expect(new Set(statePlacements.map((placement) => placement.bounds.height))).toEqual(
      new Set([800])
    );
    expect(statePlacements.map((placement) => placement.bounds.x)).toEqual([560, 2000, 560, 2000]);
  });
});
```

Add a failing UI composition placement-intent test to `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`:

```ts
it("assigns context-aware placement intent to admin table parts", async () => {
  const result = await runNode("ui.buildCompositionContract", {
    uxEnvelope: {
      schemaVersion: "UXEnvelope/v1",
      screenArchetype: "admin-data-table",
      confidence: "inferred",
      actor: "Workspace admin",
      primaryGoal: "Manage members",
      primaryTask: "Review and change member access",
      secondaryTasks: ["Invite member"],
      dataModel: { primaryEntity: "member", expectedVolume: "many", fields: ["name", "role"] },
      permissions: ["invite-member"],
      edgeCases: ["empty", "permission"],
      assumptions: [],
      sourceRefs: ["https://www.nngroup.com/articles/ten-usability-heuristics/"],
    },
    fitReport: {
      status: "ready",
      components: [
        { id: "page-shell", name: "Page Shell", componentKey: "page-shell-key" },
        { id: "primary-action", name: "Primary Action", componentKey: "button-primary-key" },
      ],
    },
  });

  expect(result.statePatch?.uiComposition?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "page-shell", placement: "left-sidebar" }),
      expect.objectContaining({ id: "primary-action", placement: "top-right-action" }),
    ])
  );
});
```

- [ ] **Step 2: Run tests red**

```bash
bun test src/core/domain/test/canvas-plan.test.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts
```

Expected: FAIL because `canvas-plan.ts` and `placement` fields do not exist.

- [ ] **Step 3: Implement pure canvas planner**

Create `src/core/domain/canvas-plan.ts`:

```ts
import { KotikitError } from "../../util/result.js";
import type { CanvasPlanSchema } from "../schemas/artifact.js";
import type { z } from "zod";

type CanvasPlan = z.infer<typeof CanvasPlanSchema>;
type Bounds = CanvasPlan["placements"][number]["bounds"];
type StateInput = { id: string; label: string; kind: string };
type DraftComponentInput = { id: string; name: string };

const DRAFT_ZONE_WIDTH = 360;
const ZONE_GAP = 200;
const SCREEN_GAP = 160;
const DEFAULT_DRAFT_COMPONENT_HEIGHT = 240;

export function buildCanvasPlan(input: {
  sectionName: string;
  sectionId?: string;
  screenTitle: string;
  screenSize: { width: number; height: number };
  states: StateInput[];
  draftComponents: DraftComponentInput[];
}): CanvasPlan {
  const screenZoneX = DRAFT_ZONE_WIDTH + ZONE_GAP;
  const placements = [
    ...input.draftComponents.map((component, index) => ({
      id: `draft-${component.id}`,
      kind: "draft-component" as const,
      draftComponentId: component.id,
      label: component.name,
      bounds: {
        x: 0,
        y: index * (DEFAULT_DRAFT_COMPONENT_HEIGHT + SCREEN_GAP),
        width: DRAFT_ZONE_WIDTH,
        height: DEFAULT_DRAFT_COMPONENT_HEIGHT,
      },
      parentZoneId: "zone-draft-components",
      transactionId: `txn-draft-${component.id}`,
    })),
    ...input.states.map((state, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      return {
        id: `state-${state.id}`,
        kind: "screen-state" as const,
        stateId: state.id,
        label: `${input.screenTitle} / ${state.label}`,
        bounds: {
          x: screenZoneX + column * (input.screenSize.width + SCREEN_GAP),
          y: row * (input.screenSize.height + SCREEN_GAP),
          width: input.screenSize.width,
          height: input.screenSize.height,
        },
        parentZoneId: "zone-screen-states",
        transactionId: `txn-state-${state.id}`,
      };
    }),
  ];

  const maxStateRows = Math.max(1, Math.ceil(input.states.length / 2));
  const plan: CanvasPlan = {
    schemaVersion: "CanvasPlan/v1",
    section: {
      ...(input.sectionId === undefined ? {} : { id: input.sectionId }),
      name: input.sectionName,
    },
    coordinateSpace: "section-relative",
    screenSize: input.screenSize,
    minGap: SCREEN_GAP,
    zones: [
      {
        id: "zone-draft-components",
        kind: "draft-components",
        label: "Draft components",
        bounds: {
          x: 0,
          y: 0,
          width: DRAFT_ZONE_WIDTH,
          height: Math.max(
            input.screenSize.height,
            input.draftComponents.length * (DEFAULT_DRAFT_COMPONENT_HEIGHT + SCREEN_GAP)
          ),
        },
      },
      {
        id: "zone-screen-states",
        kind: "screen-states",
        label: "Screen states",
        bounds: {
          x: screenZoneX,
          y: 0,
          width: 2 * input.screenSize.width + SCREEN_GAP,
          height: maxStateRows * input.screenSize.height + Math.max(0, maxStateRows - 1) * SCREEN_GAP,
        },
      },
    ],
    placements,
    strategy: {
      primaryFirst: true,
      creationOrder: placements.map((placement) => placement.id),
      designerNotes: [
        "Kotikit creates draft components first, then creates one screen state at a time.",
        "State frames are same-sized and placed in a review grid so designers can scan them without manual cleanup.",
      ],
    },
  };
  verifyCanvasPlan(plan);
  return plan;
}

export function verifyCanvasPlan(plan: CanvasPlan): void {
  plan.placements.forEach((placement) => {
    const zone = plan.zones.find((candidate) => candidate.id === placement.parentZoneId);
    if (zone === undefined) {
      throw new KotikitError(
        `Canvas placement "${placement.label}" points at an unknown zone.`,
        "Rebuild the canvas plan before applying Figma changes."
      );
    }
  });

  const overlap = plan.placements.find((left, index) =>
    plan.placements.slice(index + 1).some((right) => placementsOverlap(left, right, plan.minGap))
  );
  if (overlap !== undefined) {
    throw new KotikitError(
      `Canvas placement "${overlap.label}" overlaps another generated item.`,
      "Use the canvas plan grid before creating Figma nodes."
    );
  }
}

export function placementsOverlap(
  left: { bounds: Bounds },
  right: { bounds: Bounds },
  minGap = 0
): boolean {
  return boundsOverlap(expand(left.bounds, minGap / 2), expand(right.bounds, minGap / 2));
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function expand(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}
```

- [ ] **Step 4: Extend UI composition placement intent**

Modify `UICompositionPartSchema` in `src/core/schemas/artifact.ts`:

```ts
  placement: z
    .enum([
      "left-sidebar",
      "top-bar",
      "top-right-action",
      "main-content",
      "table-body",
      "center-region",
      "right-rail",
      "footer",
      "modal",
      "unknown",
    ])
    .optional(),
```

Modify `src/core/nodes/ui-composition/index.ts` so generated parts include placement:

```ts
function placementForPart(input: { archetype: string; partId: string; role: string }): string {
  if (input.archetype === "admin-data-table") {
    const id = input.partId.toLowerCase();
    if (id.includes("shell") || id.includes("sidebar") || input.role === "navigation") {
      return "left-sidebar";
    }
    if (id.includes("primary-action") || input.role === "primary-action") {
      return "top-right-action";
    }
    if (id.includes("table") || input.role === "data-display") {
      return "table-body";
    }
    return "main-content";
  }
  return "unknown";
}
```

Call `placementForPart` when constructing `uiComposition.parts`.

- [ ] **Step 5: Run tests green**

```bash
bun test src/core/domain/test/canvas-plan.test.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/domain/canvas-plan.ts src/core/domain/test/canvas-plan.test.ts src/core/schemas/artifact.ts src/core/nodes/ui-composition/index.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts
git commit -m "feat(core): plan non-overlapping figma canvas layout"
```

---

## Task 3: Build Incremental Figma Transaction Plans

**Files:**

- Create: `src/core/domain/figma-transaction-plan.ts`
- Create: `src/core/domain/test/figma-transaction-plan.test.ts`
- Modify: `src/core/adapters/figma/apply-packet.ts`
- Modify: `src/core/nodes/draft/index.ts`
- Modify: `src/core/nodes/draft/test/draft-nodes.test.ts`

- [ ] **Step 1: Write failing transaction-plan tests**

Create `src/core/domain/test/figma-transaction-plan.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  buildFigmaTransactionPlan,
  nextPendingTransaction,
  recordTransactionMetadata,
} from "../figma-transaction-plan.js";

describe("figma transaction plan", () => {
  it("creates draft component transactions before screen-state transactions", () => {
    const plan = buildFigmaTransactionPlan({
      placements: [
        {
          id: "draft-table-row",
          kind: "draft-component",
          label: "Draft/Table Row",
          bounds: { x: 0, y: 0, width: 360, height: 240 },
          parentZoneId: "zone-draft-components",
          transactionId: "txn-draft-table-row",
          draftComponentId: "table-row",
        },
        {
          id: "state-filled",
          kind: "screen-state",
          label: "Members / Filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          parentZoneId: "zone-screen-states",
          transactionId: "txn-state-filled",
          stateId: "filled",
        },
      ],
      creationOrder: ["draft-table-row", "state-filled"],
    });

    expect(plan.transactions.map((transaction) => transaction.id)).toEqual([
      "txn-draft-table-row",
      "txn-state-filled",
    ]);
    expect(plan.transactions[0]?.kind).toBe("create-draft-component");
    expect(nextPendingTransaction(plan)?.id).toBe("txn-draft-table-row");
  });

  it("records one transaction and leaves the next pending", () => {
    const plan = buildFigmaTransactionPlan({
      placements: [
        {
          id: "state-filled",
          kind: "screen-state",
          label: "Members / Filled",
          bounds: { x: 560, y: 0, width: 1440, height: 900 },
          parentZoneId: "zone-screen-states",
          transactionId: "txn-state-filled",
          stateId: "filled",
        },
        {
          id: "state-loading",
          kind: "screen-state",
          label: "Members / Loading",
          bounds: { x: 2160, y: 0, width: 1440, height: 900 },
          parentZoneId: "zone-screen-states",
          transactionId: "txn-state-loading",
          stateId: "loading",
        },
      ],
      creationOrder: ["state-filled", "state-loading"],
    });

    const updated = recordTransactionMetadata(plan, {
      transactionId: "txn-state-filled",
      nodeId: "9:10",
      nodeName: "Members / Filled",
      nodeKind: "FRAME",
      bounds: { x: 560, y: 0, width: 1440, height: 900 },
      componentRefs: ["button-primary-key"],
      variableRefs: ["var-color-primary"],
      autoLayout: true,
      recordedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(updated.transactions.map((transaction) => transaction.status)).toEqual([
      "recorded",
      "pending",
    ]);
  });
});
```

- [ ] **Step 2: Run tests red**

```bash
bun test src/core/domain/test/figma-transaction-plan.test.ts
```

Expected: FAIL because `figma-transaction-plan.ts` does not exist.

- [ ] **Step 3: Implement transaction planner**

Create `src/core/domain/figma-transaction-plan.ts`:

```ts
import { KotikitError } from "../../util/result.js";
import type { CanvasPlanSchema, FigmaTransactionPlanSchema } from "../schemas/artifact.js";
import type { z } from "zod";

type CanvasPlan = z.infer<typeof CanvasPlanSchema>;
type FigmaTransactionPlan = z.infer<typeof FigmaTransactionPlanSchema>;
type Placement = CanvasPlan["placements"][number];

export function buildFigmaTransactionPlan(input: {
  placements: Placement[];
  creationOrder: string[];
}): FigmaTransactionPlan {
  const placementById = new Map(input.placements.map((placement) => [placement.id, placement]));
  return {
    schemaVersion: "FigmaTransactionPlan/v1",
    mode: "incremental-official-figma-mcp",
    transactions: input.creationOrder.map((placementId, index) => {
      const placement = placementById.get(placementId);
      if (placement === undefined) {
        throw new KotikitError(
          `Canvas creation order references unknown placement "${placementId}".`,
          "Rebuild the canvas plan before applying Figma changes."
        );
      }
      return {
        id: placement.transactionId,
        order: index + 1,
        kind:
          placement.kind === "draft-component"
            ? "create-draft-component"
            : placement.kind === "screen-state"
              ? "create-screen-state"
              : "verify-created-node",
        label: placement.label,
        placementId: placement.id,
        ...(placement.stateId === undefined ? {} : { stateId: placement.stateId }),
        ...(placement.draftComponentId === undefined
          ? {}
          : { draftComponentId: placement.draftComponentId }),
        status: "pending" as const,
        requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs", "variable-refs"],
      };
    }),
  };
}

export function nextPendingTransaction(
  plan: FigmaTransactionPlan
): FigmaTransactionPlan["transactions"][number] | undefined {
  return [...plan.transactions]
    .sort((left, right) => left.order - right.order)
    .find((transaction) => transaction.status === "pending" || transaction.status === "active");
}

export function markTransactionActive(
  plan: FigmaTransactionPlan,
  transactionId: string
): FigmaTransactionPlan {
  return {
    ...plan,
    transactions: plan.transactions.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, status: "active" } : transaction
    ),
  };
}

export function recordTransactionMetadata(
  plan: FigmaTransactionPlan,
  metadata: { transactionId: string }
): FigmaTransactionPlan {
  let found = false;
  const transactions = plan.transactions.map((transaction) => {
    if (transaction.id !== metadata.transactionId) return transaction;
    found = true;
    return { ...transaction, status: "recorded" as const };
  });
  if (!found) {
    throw new KotikitError(
      `Recorded Figma metadata for unknown transaction "${metadata.transactionId}".`,
      "Apply the active transaction from the kotikit apply packet before recording metadata."
    );
  }
  return { ...plan, transactions };
}

export function transactionPlanComplete(plan: FigmaTransactionPlan): boolean {
  return plan.transactions.every((transaction) => transaction.status === "recorded");
}
```

- [ ] **Step 4: Extend apply packet and draft nodes**

Modify `src/core/adapters/figma/apply-packet.ts`:

```ts
import type {
  CanvasPlan,
  FigmaTransactionPlan,
  LayoutContract,
  UICompositionContract,
  VariableBindingPlan,
} from "../../schemas/artifact.js";
```

Add fields to `FigmaApplyPacket`:

```ts
  canvasPlan: CanvasPlan;
  transactionPlan: FigmaTransactionPlan;
```

Add required inputs to `buildFigmaApplyPacket`:

```ts
  canvasPlan?: CanvasPlan;
  transactionPlan?: FigmaTransactionPlan;
```

Reject missing inputs:

```ts
    input.canvasPlan === undefined ||
    input.transactionPlan === undefined
```

Return:

```ts
    canvasPlan: input.canvasPlan,
    transactionPlan: input.transactionPlan,
    metadata: {
      requiresApplyMetadata: true,
      verifyComponentRefs: true,
      verifyVariables: true,
      verifyAutoLayout: true,
      incrementalTransactions: true,
    },
```

Modify `src/core/nodes/draft/index.ts`:

- import `buildCanvasPlan` and `buildFigmaTransactionPlan`;
- add node `draft.buildCanvasPlan`;
- add node `draft.buildFigmaTransactionPlan`;
- pass `canvasPlan` and `figmaTransactionPlan` into `buildFigmaApplyPacket`;
- include canvas/transaction summaries in the `figma-apply-packet` artifact.

Add node definitions:

```ts
node({
  key: "draft.buildCanvasPlan",
  stateReads: ["figmaTarget", "screen", "stateMatrix", "draftComponentPlan"],
  stateWrites: ["canvasPlan"],
  run: async (input) => {
    const state = graphState(input.state);
    const target = ensureDraftTarget(state.figmaTarget);
    const states = recordArray(recordFrom(state.stateMatrix).states).map((item) => ({
      id: String(item.id),
      label: String(item.label),
      kind: String(item.kind),
    }));
    const draftComponents = recordArray(recordFrom(state.draftComponentPlan).components).map(
      (item) => ({ id: String(item.id), name: String(item.name) })
    );
    return {
      statePatch: {
        canvasPlan: buildCanvasPlan({
          sectionName: target.section?.name ?? `kotikit / ${screenTitle(state)}`,
          sectionId: target.section?.id,
          screenTitle: screenTitle(state),
          screenSize: { width: 1440, height: 900 },
          states,
          draftComponents,
        }),
      },
    } satisfies RuntimeNodeOutput;
  },
}),
node({
  key: "draft.buildFigmaTransactionPlan",
  stateReads: ["canvasPlan"],
  stateWrites: ["figmaTransactionPlan"],
  run: async (input) => {
    const canvasPlan = stateCanvasPlan(graphState(input.state).canvasPlan);
    return {
      statePatch: {
        figmaTransactionPlan: buildFigmaTransactionPlan({
          placements: canvasPlan.placements,
          creationOrder: canvasPlan.strategy.creationOrder,
        }),
      },
    } satisfies RuntimeNodeOutput;
  },
}),
```

Add small parser helpers using `CanvasPlanSchema.parse`.

- [ ] **Step 5: Run focused tests green**

```bash
bun test src/core/domain/test/figma-transaction-plan.test.ts src/core/nodes/draft/test/draft-nodes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/domain/figma-transaction-plan.ts src/core/domain/test/figma-transaction-plan.test.ts src/core/adapters/figma/apply-packet.ts src/core/nodes/draft/index.ts src/core/nodes/draft/test/draft-nodes.test.ts
git commit -m "feat(graph): build incremental figma transaction plans"
```

---

## Task 4: Support Repeated Figma Interrupts Without Graph Cycles

**Files:**

- Modify: `src/core/graph/interrupts.ts`
- Modify: `src/core/graph/runtime.ts`
- Create: `src/core/graph/test/figma-transaction-interrupt.test.ts`

- [ ] **Step 1: Write failing runtime test**

Create `src/core/graph/test/figma-transaction-interrupt.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createArtifactStore } from "../../runs/artifact-store.js";
import { createCheckpointStore } from "../../runs/checkpoint-store.js";
import { createRunStore } from "../../runs/run-store.js";
import type { NodeRegistry } from "../node-registry.js";
import { createGraphRuntime } from "../runtime.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-figma-transaction-interrupt-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("same-node Figma interrupts", () => {
  it("can resume the same external-action node until its transaction queue is done", async () => {
    let visits = 0;
    const registry: NodeRegistry = {
      get(key) {
        if (key !== "figma.applyTransactionQueue") throw new Error(key);
        return {
          key,
          version: "1.0.0",
          kind: "external-action",
          paramsSchema: z.strictObject({}),
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          stateReads: ["figmaTransactionPlan", "applyMetadata"],
          stateWrites: ["figmaTransactionPlan"],
          sideEffects: "figma-write",
          requiredCapabilities: ["figma.write.remote"],
          run: async ({ state }) => {
            visits += 1;
            if (visits === 1) {
              return {
                statePatch: { activeFigmaTransaction: { id: "txn-1" } },
                interrupt: { status: "waiting-for-figma", resume: "same-node" },
              };
            }
            return { statePatch: { activeFigmaTransaction: undefined } };
          },
        };
      },
    };
    const runtime = createGraphRuntime({
      registry,
      flowCatalog: [
        {
          schemaVersion: 1,
          id: "test-flow",
          version: "1.0.0",
          title: "Test Flow",
          stateSchema: "KotikitGraphState/v1",
          requiredCapabilities: ["figma.write.remote"],
          nodes: [{ id: "apply", uses: "figma.applyTransactionQueue", params: {} }],
          edges: [],
          start: "apply",
          end: ["apply"],
          safetyProfile: "test",
        },
      ],
      runStore: createRunStore(root),
      artifactStore: createArtifactStore(root),
      checkpointStore: createCheckpointStore(root),
    });

    const first = await runtime.startFlow({
      flowId: "test-flow",
      input: { project: { root: "/tmp/project" } },
    });
    expect(first.status).toBe("waiting-for-figma");

    const second = await runtime.continueRun({ runId: first.runId });
    expect(second.status).toBe("done");
    expect(visits).toBe(2);
  });
});
```

- [ ] **Step 2: Run test red**

```bash
bun test src/core/graph/test/figma-transaction-interrupt.test.ts
```

Expected: FAIL because `RuntimeInterrupt` has no `resume` field and waiting-for-figma always advances to the next node.

- [ ] **Step 3: Extend runtime interrupt**

Modify `src/core/graph/interrupts.ts`:

```ts
export type RuntimeInterrupt = {
  status: Extract<KotikitGraphState["status"], "waiting-for-user" | "waiting-for-figma">;
  pendingQuestion?: NonNullable<KotikitGraphState["pendingQuestion"]>;
  resume?: "same-node" | "next-node";
};
```

Update `isRuntimeInterrupt`:

```ts
  const resume = candidate.resume;
  if (resume !== undefined && resume !== "same-node" && resume !== "next-node") return false;
```

Modify `src/core/graph/runtime.ts` interrupt handling:

```ts
const resumeMode = output.interrupt.resume ?? output.interrupt.status === "waiting-for-user"
  ? "same-node"
  : "next-node";
```

Use:

```ts
nextNodeIndex: resumeMode === "same-node" ? run.nextNodeIndex : run.nextNodeIndex + 1,
```

Keep existing behavior for `waiting-for-user` and existing `waiting-for-figma` nodes by defaulting Figma to `next-node` unless a node explicitly asks for `same-node`.

- [ ] **Step 4: Run runtime tests green**

```bash
bun test src/core/graph/test/figma-transaction-interrupt.test.ts src/core/graph/test/compiler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph/interrupts.ts src/core/graph/runtime.ts src/core/graph/test/figma-transaction-interrupt.test.ts
git commit -m "feat(graph): support same-node figma interrupts"
```

---

## Task 5: Implement Figma Transaction Queue Node

**Files:**

- Modify: `src/core/nodes/figma/index.ts`
- Modify: `src/core/nodes/figma/test/figma-nodes.test.ts`
- Modify: `src/core/nodes/built-in-registry.ts`
- Modify: `src/mcp/facade/tools.ts`
- Modify: `src/mcp/facade/test/tools.test.ts`

- [ ] **Step 1: Write failing Figma node tests**

Append to `src/core/nodes/figma/test/figma-nodes.test.ts`:

```ts
it("applies one transaction at a time and waits on the same graph node", async () => {
  const result = await runNode("figma.applyTransactionQueue", {
    figmaTarget: draftTarget(),
    figmaTransactionPlan: {
      schemaVersion: "FigmaTransactionPlan/v1",
      mode: "incremental-official-figma-mcp",
      transactions: [
        {
          id: "txn-state-filled",
          order: 1,
          kind: "create-screen-state",
          label: "Members / Filled",
          placementId: "state-filled",
          stateId: "filled",
          status: "pending",
          requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs"],
        },
      ],
    },
  });

  expect(result.interrupt).toEqual({ status: "waiting-for-figma", resume: "same-node" });
  expect(result.statePatch?.activeFigmaTransaction).toMatchObject({
    id: "txn-state-filled",
    label: "Members / Filled",
  });
});

it("records active transaction metadata into the node ledger", async () => {
  const result = await runNode("figma.applyTransactionQueue", {
    figmaTarget: draftTarget(),
    activeFigmaTransaction: {
      id: "txn-state-filled",
      label: "Members / Filled",
      placementId: "state-filled",
      stateId: "filled",
    },
    figmaTransactionPlan: {
      schemaVersion: "FigmaTransactionPlan/v1",
      mode: "incremental-official-figma-mcp",
      transactions: [
        {
          id: "txn-state-filled",
          order: 1,
          kind: "create-screen-state",
          label: "Members / Filled",
          placementId: "state-filled",
          stateId: "filled",
          status: "active",
          requiredMetadata: ["node-id", "bounds", "auto-layout", "component-refs"],
        },
      ],
    },
    applyMetadata: {
      transactionId: "txn-state-filled",
      figmaNodeId: "9:10",
      figmaNodeName: "Members / Filled",
      figmaNodeKind: "FRAME",
      bounds: { x: 560, y: 0, width: 1440, height: 900 },
      componentRefs: ["button-primary-key"],
      variableRefs: ["var-color-primary"],
      autoLayout: true,
    },
  });

  expect(result.statePatch?.activeFigmaTransaction).toBeUndefined();
  expect(result.statePatch?.figmaNodeLedger).toMatchObject({
    schemaVersion: "FigmaNodeLedger/v1",
    nodes: [expect.objectContaining({ nodeId: "9:10", transactionId: "txn-state-filled" })],
  });
  expect(result.statePatch?.figmaTransactionPlan).toMatchObject({
    transactions: [expect.objectContaining({ id: "txn-state-filled", status: "recorded" })],
  });
});
```

Add a failing MCP schema test in `src/mcp/facade/test/tools.test.ts`:

```ts
it("records transaction id and bounds for incremental Figma apply metadata", () => {
  const { registry } = buildServer();
  const applyTool = registry.tools.find((tool) => tool.name === "kotikit_record_figma_apply");
  expect(applyTool?.inputSchema.properties).toHaveProperty("transactionId");
  expect(applyTool?.inputSchema.properties).toHaveProperty("bounds");
  expect(applyTool?.inputSchema.properties).toHaveProperty("componentRefs");
  expect(applyTool?.inputSchema.properties).toHaveProperty("variableRefs");
});
```

- [ ] **Step 2: Run tests red**

```bash
bun test src/core/nodes/figma/test/figma-nodes.test.ts src/mcp/facade/test/tools.test.ts
```

Expected: FAIL because `figma.applyTransactionQueue` and metadata fields do not exist.

- [ ] **Step 3: Implement queue node**

Modify `src/core/nodes/figma/index.ts`:

- import `FigmaNodeLedgerSchema`, `FigmaTransactionPlanSchema`;
- import `markTransactionActive`, `nextPendingTransaction`, `recordTransactionMetadata`, and `transactionPlanComplete`;
- add node `figma.applyTransactionQueue`.

Core node logic:

```ts
node({
  key: "figma.applyTransactionQueue",
  kind: "external-action",
  stateReads: ["figmaTarget", "figmaTransactionPlan", "activeFigmaTransaction", "applyMetadata"],
  stateWrites: ["figmaTransactionPlan", "activeFigmaTransaction", "figmaNodeLedger", "applyReport"],
  sideEffects: "figma-write",
  requiredCapabilities: ["figma.write.remote"],
  run: async (input) => {
    const state = graphState(input.state);
    const target = ensureDraftTarget(state.figmaTarget);
    const plan = FigmaTransactionPlanSchema.parse(state.figmaTransactionPlan);
    const active = recordFrom(state.activeFigmaTransaction);
    const metadata = recordFrom(state.applyMetadata);

    if (active.id !== undefined) {
      const transactionId = String(active.id);
      if (metadata.transactionId !== transactionId) {
        throw new KotikitError(
          `Kotikit is waiting for Figma metadata for "${String(active.label ?? transactionId)}".`,
          "Apply the active transaction from the kotikit packet, then record metadata with the same transactionId."
        );
      }
      const nextPlan = recordTransactionMetadata(plan, { transactionId });
      const nextLedger = appendLedgerNode({
        target,
        previous: state.figmaNodeLedger,
        active,
        metadata,
      });
      if (transactionPlanComplete(nextPlan)) {
        return {
          statePatch: {
            applyMetadata: undefined,
            activeFigmaTransaction: undefined,
            figmaTransactionPlan: nextPlan,
            figmaNodeLedger: nextLedger,
            applyReport: applyReportFromLedger(target, nextLedger),
          },
        } satisfies RuntimeNodeOutput;
      }
      const next = nextPendingTransaction(nextPlan);
      return {
        statePatch: {
          applyMetadata: undefined,
          activeFigmaTransaction: next,
          figmaTransactionPlan: markTransactionActive(nextPlan, next?.id ?? ""),
          figmaNodeLedger: nextLedger,
        },
        interrupt: { status: "waiting-for-figma", resume: "same-node" },
      } satisfies RuntimeNodeOutput;
    }

    const next = nextPendingTransaction(plan);
    if (next === undefined) {
      return { statePatch: { applyReport: applyReportFromLedger(target, state.figmaNodeLedger) } };
    }
    return {
      statePatch: {
        activeFigmaTransaction: next,
        figmaTransactionPlan: markTransactionActive(plan, next.id),
      },
      interrupt: { status: "waiting-for-figma", resume: "same-node" },
    } satisfies RuntimeNodeOutput;
  },
}),
```

Implement `appendLedgerNode` and `applyReportFromLedger` with strict checks:

- require `figmaNodeId`;
- require positive `bounds.width` and `bounds.height`;
- require `autoLayout === true` for screen-state and layout-frame transactions;
- require file/page/section to match `figmaTarget`;
- copy `componentRefs` and `variableRefs` as string arrays;
- never store raw full node trees in graph state.

- [ ] **Step 4: Extend MCP apply metadata schema**

Modify `figmaApplyInputSchema()` in `src/mcp/facade/tools.ts` to add:

```ts
transactionId: { type: "string", description: "Active Figma transaction id from the apply packet." },
bounds: {
  type: "object",
  description: "Absolute or section-relative bounds for the created node.",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
},
componentRefs: { type: "array", items: { type: "string" } },
variableRefs: { type: "array", items: { type: "string" } },
autoLayout: { type: "boolean" },
```

Modify `figmaApplyMetadataFrom()` to preserve these fields in `applyMetadata`.

- [ ] **Step 5: Run focused tests green**

```bash
bun test src/core/nodes/figma/test/figma-nodes.test.ts src/mcp/facade/test/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/nodes/figma/index.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/nodes/built-in-registry.ts src/mcp/facade/tools.ts src/mcp/facade/test/tools.test.ts
git commit -m "feat(figma): apply draft transactions incrementally"
```

---

## Task 6: Update Create-Screen Flow To Use Incremental Apply

**Files:**

- Modify: `src/core/flows/built-in/create-screen.flow.json`
- Modify: `src/core/nodes/test/built-in-node-registry.test.ts`
- Modify: `e2e/graph/fixtures/fake-figma.ts`
- Modify: `e2e/graph/create-screen-flow.test.ts`

- [ ] **Step 1: Write failing E2E expectations**

Modify `e2e/graph/create-screen-flow.test.ts` to assert:

```ts
expect(waitingForApply.state.canvasPlan).toMatchObject({
  schemaVersion: "CanvasPlan/v1",
});
expect(waitingForApply.state.figmaTransactionPlan).toMatchObject({
  schemaVersion: "FigmaTransactionPlan/v1",
  mode: "incremental-official-figma-mcp",
});
expect(waitingForApply.state.activeFigmaTransaction).toMatchObject({
  id: expect.stringMatching(/^txn-/),
});
```

After applying fake metadata repeatedly, assert:

```ts
expect(done.state.figmaNodeLedger).toMatchObject({
  schemaVersion: "FigmaNodeLedger/v1",
});
expect(done.state.figmaTransactionPlan?.transactions.every((item) => item.status === "recorded")).toBe(true);
expect(done.state.uiQualityGate?.status).toBe("passed");
```

Modify `e2e/graph/fixtures/fake-figma.ts` to add:

```ts
export async function drainFakeFigmaTransactions(
  runtime: GraphRuntime,
  runId: string
): Promise<KotikitGraphState> {
  let state = await runtime.getRunState(runId);
  while (state.status === "waiting-for-figma") {
    const active = recordFrom(state.activeFigmaTransaction);
    await runtime.patchRunState({
      runId,
      statePatch: {
        applyMetadata: fakeTransactionMetadataFor(state),
      },
    });
    const result = await runtime.continueRun({ runId });
    state = result.state;
    if (active.id === undefined) {
      throw new Error("Missing active fake transaction.");
    }
  }
  return state;
}
```

Implement `fakeTransactionMetadataFor(state)` in the same file to return metadata for the current `activeFigmaTransaction`, including `transactionId`, `figmaNodeId`, `figmaNodeName`, `figmaNodeKind`, `bounds`, `componentRefs`, `variableRefs`, and `autoLayout`.

- [ ] **Step 2: Run E2E red**

```bash
bun test e2e/graph/create-screen-flow.test.ts src/core/nodes/test/built-in-node-registry.test.ts
```

Expected: FAIL because create-screen still uses the old one-shot wait/record path.

- [ ] **Step 3: Update flow manifest**

Modify `src/core/flows/built-in/create-screen.flow.json`:

- insert `build-canvas-plan` after `compile-high-fidelity-draft`;
- insert `build-figma-transaction-plan` after `build-canvas-plan`;
- keep `build-figma-apply-packet` after transaction planning;
- replace `wait-for-apply-metadata` and `record-apply-metadata` with one `apply-figma-transaction-queue` node using `figma.applyTransactionQueue`;
- keep downstream validation and QA nodes.

Expected node chain:

```json
["compile-high-fidelity-draft", "build-canvas-plan"],
["build-canvas-plan", "build-figma-transaction-plan"],
["build-figma-transaction-plan", "build-figma-apply-packet"],
["build-figma-apply-packet", "apply-figma-transaction-queue"],
["apply-figma-transaction-queue", "build-draft-component-lifecycle"]
```

Add nodes:

```json
{
  "id": "build-canvas-plan",
  "uses": "draft.buildCanvasPlan",
  "params": {}
},
{
  "id": "build-figma-transaction-plan",
  "uses": "draft.buildFigmaTransactionPlan",
  "params": {}
},
{
  "id": "apply-figma-transaction-queue",
  "uses": "figma.applyTransactionQueue",
  "params": {}
}
```

Update `src/core/nodes/test/built-in-node-registry.test.ts` to assert this order.

- [ ] **Step 4: Run E2E green**

```bash
bun test e2e/graph/create-screen-flow.test.ts src/core/nodes/test/built-in-node-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/flows/built-in/create-screen.flow.json src/core/nodes/test/built-in-node-registry.test.ts e2e/graph/fixtures/fake-figma.ts e2e/graph/create-screen-flow.test.ts
git commit -m "feat(graph): create screen through figma transaction queue"
```

---

## Task 7: Reconcile Moved Figma Nodes Before Comment Review

**Files:**

- Create: `src/core/domain/canvas-reconciliation.ts`
- Create: `src/core/domain/test/canvas-reconciliation.test.ts`
- Modify: `src/core/nodes/comments/index.ts`
- Modify: `src/core/nodes/comments/test/comments-nodes.test.ts`
- Modify: `src/core/flows/built-in/review-comments.flow.json`
- Modify: `e2e/graph/review-comments-flow.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Create `src/core/domain/test/canvas-reconciliation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { reconcileCanvasNodes } from "../canvas-reconciliation.js";

describe("canvas reconciliation", () => {
  it("keeps moved nodes mapped by node id and updates current bounds", () => {
    const report = reconcileCanvasNodes({
      fileKey: "FILE",
      pageId: "1:2",
      now: "2026-07-01T00:00:00.000Z",
      ledger: {
        schemaVersion: "FigmaNodeLedger/v1",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-07-01",
        updatedAt: "2026-07-01T00:00:00.000Z",
        nodes: [
          {
            nodeId: "9:10",
            name: "Members / Filled",
            kind: "FRAME",
            semanticRole: "screen-state",
            transactionId: "txn-state-filled",
            placementId: "state-filled",
            stateId: "filled",
            bounds: { x: 560, y: 0, width: 1440, height: 900 },
            componentRefs: [],
            variableRefs: [],
            autoLayout: true,
            recordedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
      currentNodes: [
        {
          nodeId: "9:10",
          name: "Members / Filled v2",
          bounds: { x: 1200, y: 400, width: 1440, height: 900 },
        },
      ],
    });

    expect(report.nodes[0]).toMatchObject({
      nodeId: "9:10",
      ledgerStatus: "moved",
      currentBounds: { x: 1200, y: 400, width: 1440, height: 900 },
      transactionId: "txn-state-filled",
    });
  });

  it("flags missing ledger nodes as human-risk for comment mapping", () => {
    const report = reconcileCanvasNodes({
      fileKey: "FILE",
      pageId: "1:2",
      now: "2026-07-01T00:00:00.000Z",
      ledger: {
        schemaVersion: "FigmaNodeLedger/v1",
        fileKey: "FILE",
        pageId: "1:2",
        sectionName: "kotikit / members / 2026-07-01",
        updatedAt: "2026-07-01T00:00:00.000Z",
        nodes: [
          {
            nodeId: "missing",
            name: "Members / Filled",
            kind: "FRAME",
            semanticRole: "screen-state",
            transactionId: "txn-state-filled",
            placementId: "state-filled",
            bounds: { x: 560, y: 0, width: 1440, height: 900 },
            componentRefs: [],
            variableRefs: [],
            autoLayout: true,
            recordedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
      currentNodes: [],
    });

    expect(report.unmappedCommentsRisk).toBe("needs-human");
    expect(report.nodes[0]?.ledgerStatus).toBe("missing");
  });
});
```

- [ ] **Step 2: Run tests red**

```bash
bun test src/core/domain/test/canvas-reconciliation.test.ts
```

Expected: FAIL because reconciliation module does not exist.

- [ ] **Step 3: Implement reconciliation**

Create `src/core/domain/canvas-reconciliation.ts`:

```ts
import type { CanvasReconciliationReportSchema, FigmaNodeLedgerSchema } from "../schemas/artifact.js";
import type { z } from "zod";

type Ledger = z.infer<typeof FigmaNodeLedgerSchema>;
type Report = z.infer<typeof CanvasReconciliationReportSchema>;
type CurrentNode = {
  nodeId: string;
  name: string;
  bounds?: { x: number; y: number; width: number; height: number };
};

export function reconcileCanvasNodes(input: {
  fileKey: string;
  pageId: string;
  now: string;
  ledger: Ledger;
  currentNodes: CurrentNode[];
}): Report {
  const currentById = new Map(input.currentNodes.map((node) => [node.nodeId, node]));
  const nodes = input.ledger.nodes.map((ledgerNode) => {
    const current = currentById.get(ledgerNode.nodeId);
    if (current === undefined) {
      return {
        nodeId: ledgerNode.nodeId,
        ledgerStatus: "missing" as const,
        previousBounds: ledgerNode.bounds,
        previousName: ledgerNode.name,
        transactionId: ledgerNode.transactionId,
        placementId: ledgerNode.placementId,
        ...(ledgerNode.stateId === undefined ? {} : { stateId: ledgerNode.stateId }),
      };
    }
    const moved =
      current.bounds !== undefined &&
      JSON.stringify(current.bounds) !== JSON.stringify(ledgerNode.bounds);
    const renamed = current.name !== ledgerNode.name;
    return {
      nodeId: ledgerNode.nodeId,
      ledgerStatus: moved ? "moved" : renamed ? "renamed" : "matched",
      previousBounds: ledgerNode.bounds,
      ...(current.bounds === undefined ? {} : { currentBounds: current.bounds }),
      previousName: ledgerNode.name,
      currentName: current.name,
      transactionId: ledgerNode.transactionId,
      placementId: ledgerNode.placementId,
      ...(ledgerNode.stateId === undefined ? {} : { stateId: ledgerNode.stateId }),
    };
  });

  return {
    schemaVersion: "CanvasReconciliationReport/v1",
    fileKey: input.fileKey,
    pageId: input.pageId,
    reconciledAt: input.now,
    nodes,
    unmappedCommentsRisk: nodes.some((node) => node.ledgerStatus === "missing")
      ? "needs-human"
      : "none",
  };
}
```

- [ ] **Step 4: Add comment graph node**

Modify `src/core/nodes/comments/index.ts`:

- add node `comments.reconcileCanvas`;
- read `figmaNodeLedger` and `review.currentNodes`;
- write `canvasReconciliation`;
- produce a `canvas-reconciliation-report` artifact.

The node must not call Figma directly. Current nodes are supplied by the agent through a compact review seed or future MCP read surface.

Add tests in `src/core/nodes/comments/test/comments-nodes.test.ts` proving:

- moved nodes remain mapped by node id;
- missing nodes create `unmappedCommentsRisk: "needs-human"`;
- `comments.buildEvidenceMap` can use `canvasReconciliation.currentBounds` before falling back to ledger bounds.

- [ ] **Step 5: Update review-comments flow**

Modify `src/core/flows/built-in/review-comments.flow.json` so the start path is:

```json
["fetch-comment-snapshot", "reconcile-canvas"],
["reconcile-canvas", "build-comment-evidence-map"]
```

Add node:

```json
{
  "id": "reconcile-canvas",
  "uses": "comments.reconcileCanvas",
  "params": {}
}
```

- [ ] **Step 6: Run focused tests green**

```bash
bun test src/core/domain/test/canvas-reconciliation.test.ts src/core/nodes/comments/test/comments-nodes.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/domain/canvas-reconciliation.ts src/core/domain/test/canvas-reconciliation.test.ts src/core/nodes/comments/index.ts src/core/nodes/comments/test/comments-nodes.test.ts src/core/flows/built-in/review-comments.flow.json e2e/graph/review-comments-flow.test.ts
git commit -m "feat(comments): reconcile figma canvas before review"
```

---

## Task 8: Add Placement-Aware QA Gates

**Files:**

- Modify: `src/core/domain/ui-quality-gate.ts`
- Modify: `src/core/nodes/qa/index.ts`
- Modify: `src/core/nodes/qa/test/qa-nodes.test.ts`
- Modify: `src/core/nodes/figma/index.ts`
- Modify: `src/core/nodes/figma/test/figma-nodes.test.ts`

- [ ] **Step 1: Write failing QA tests**

Append to `src/core/nodes/qa/test/qa-nodes.test.ts`:

```ts
it("blocks overlapping canvas placements from the node ledger", async () => {
  const result = await runNode("qa.runUiQualityGate", {
    applyReport: {
      schemaVersion: "FigmaApplyReport/v1",
      nodes: [
        {
          id: "state-filled",
          semanticRole: "screen-state",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          overlaps: [],
        },
        {
          id: "state-loading",
          semanticRole: "screen-state",
          bounds: { x: 100, y: 100, width: 1440, height: 900 },
          overlaps: [],
        },
      ],
    },
  });

  expect(result.statePatch?.uiQualityGate).toMatchObject({
    status: "blocked",
    checks: [expect.objectContaining({ id: "canvas-overlap", status: "blocked" })],
  });
});

it("blocks screen-state frames that are not auto layout", async () => {
  const result = await runNode("qa.runUiQualityGate", {
    applyReport: {
      schemaVersion: "FigmaApplyReport/v1",
      nodes: [
        {
          id: "state-filled",
          semanticRole: "screen-state",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          autoLayout: false,
          overlaps: [],
        },
      ],
    },
  });

  expect(result.statePatch?.uiQualityGate).toMatchObject({
    status: "blocked",
    checks: [expect.objectContaining({ id: "screen-state-auto-layout", status: "blocked" })],
  });
});
```

- [ ] **Step 2: Run tests red**

```bash
bun test src/core/nodes/qa/test/qa-nodes.test.ts
```

Expected: FAIL because these checks do not exist.

- [ ] **Step 3: Implement QA checks**

Modify `src/core/domain/ui-quality-gate.ts` to add:

```ts
checkCanvasOverlap(input.nodes),
checkScreenStateAutoLayout(input.nodes),
checkMissingTransactionMetadata(input.nodes),
```

Implement:

```ts
function checkCanvasOverlap(nodes: AppliedNode[]): UIQualityGateReport["checks"][number] {
  const findings: string[] = [];
  nodes.forEach((left, index) => {
    nodes.slice(index + 1).forEach((right) => {
      if (hasBounds(left) && hasBounds(right) && boundsOverlap(left.bounds, right.bounds)) {
        findings.push(`${String(left.id ?? "unknown")} overlaps ${String(right.id ?? "unknown")}`);
      }
    });
  });
  return checkResult("canvas-overlap", "Canvas overlap", findings);
}

function checkScreenStateAutoLayout(nodes: AppliedNode[]): UIQualityGateReport["checks"][number] {
  return checkResult(
    "screen-state-auto-layout",
    "Screen state auto layout",
    nodes
      .filter((node) => node.semanticRole === "screen-state" && node.autoLayout !== true)
      .map((node) => String(node.id ?? "unknown"))
  );
}

function checkMissingTransactionMetadata(
  nodes: AppliedNode[]
): UIQualityGateReport["checks"][number] {
  return checkResult(
    "transaction-metadata",
    "Transaction metadata",
    nodes
      .filter((node) => node.transactionId === undefined || node.placementId === undefined)
      .map((node) => String(node.id ?? "unknown"))
  );
}
```

Add recommended actions:

```ts
"canvas-overlap": "Move generated frames into the canvas plan grid before continuing.",
"screen-state-auto-layout": "Rebuild the screen state as an auto-layout frame.",
"transaction-metadata": "Record transactionId and placementId for every generated node.",
```

- [ ] **Step 4: Run QA tests green**

```bash
bun test src/core/nodes/qa/test/qa-nodes.test.ts src/core/domain/test/canvas-plan.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/domain/ui-quality-gate.ts src/core/nodes/qa/index.ts src/core/nodes/qa/test/qa-nodes.test.ts
git commit -m "feat(qa): block overlapping incremental figma output"
```

---

## Task 9: Update Agent Instructions, Skills, And Docs

**Files:**

- Modify: `src/mcp/instructions.ts`
- Modify: `src/mcp/facade/prompts.ts`
- Modify: `.agents/skills/kotikit-auto/SKILL.md`
- Modify: `.agents/skills/kotikit-design-review/SKILL.md`
- Modify: `plugins/codex/kotikit/skills/kotikit/SKILL.md`
- Modify: `plugins/claude/kotikit/skills/kotikit/SKILL.md`
- Modify: `README.md`
- Modify: `docs/workflows.md`
- Modify: `docs/figma.md`
- Modify: `docs/tools.md`
- Modify: `docs/modules/mcp.md`
- Modify: `docs/troubleshooting.md`
- Modify: `KOTIKIT_MIGRATION.md`
- Modify: `src/test/tooling-config.test.ts`

- [ ] **Step 1: Write failing docs/skills text test**

Modify `src/test/tooling-config.test.ts`:

```ts
it("documents incremental Figma apply instead of one-shot state dumping", () => {
  const docs = [
    readFileSync("README.md", "utf8"),
    readFileSync("docs/workflows.md", "utf8"),
    readFileSync("docs/figma.md", "utf8"),
    readFileSync(".agents/skills/kotikit-auto/SKILL.md", "utf8"),
  ].join("\n");

  expect(docs).toContain("incremental Figma");
  expect(docs).toContain("one screen state at a time");
  expect(docs).toContain("canvas plan");
  expect(docs).not.toContain("dump all states");
});
```

- [ ] **Step 2: Run test red**

```bash
bun test src/test/tooling-config.test.ts
```

Expected: FAIL because docs do not yet describe incremental Figma apply.

- [ ] **Step 3: Update MCP instructions and prompts**

Update `src/mcp/instructions.ts` to say:

```text
- Apply Figma drafts incrementally. Fetch the graph apply packet, apply only the active Figma transaction, record transactionId, node id, bounds, component refs, variable refs, and auto-layout metadata, then continue the run. Do not create all screen states in one opaque Figma write.
- Keep generated frames inside the kotikit canvas plan. State frames must be same-sized, non-overlapping, and placed in the planned grid. Draft components stay in the draft component zone.
```

Update `src/mcp/facade/prompts.ts` so `kotikit.create_figma_draft` instructs the assistant to:

- read the active transaction;
- apply one transaction;
- call `kotikit_record_figma_apply`;
- continue until no active transaction remains;
- use `use_figma` for deterministic writes;
- use `generate_figma_design` only for web/page capture references, not normal kotikit draft composition.

- [ ] **Step 4: Update skills**

In `.agents/skills/kotikit-auto/SKILL.md` and both plugin skill copies, add:

```md
When applying a kotikit draft in Figma:

- Use the apply packet's active transaction.
- Create exactly one draft component, screen state, or region state per Figma write.
- Place it at the bounds from the canvas plan.
- Use auto layout, imported design-system component instances, and variables/styles.
- Record `transactionId`, node id, bounds, component refs, variable refs, and auto-layout metadata with `kotikit_record_figma_apply`.
- Continue the run and repeat until kotikit reports no active Figma transaction.
- Do not dump every state onto the canvas in one operation.
```

In `.agents/skills/kotikit-design-review/SKILL.md`, add:

```md
Before reviewing comments on kotikit-generated work, let kotikit reconcile the current canvas map. Designers may move or rename generated frames; do not guess comment targets when the ledger cannot map them.
```

- [ ] **Step 5: Update live docs**

Update `docs/workflows.md` quick high-fidelity section:

```md
Kotikit applies Figma drafts incrementally. It creates draft components first,
then creates the filled screen, then creates each required state one at a time.
Each generated node is placed by the canvas plan and recorded in the node
ledger so comment review can still work after designers move frames.
```

Update `docs/figma.md`:

```md
Normal kotikit draft creation uses deterministic `use_figma` writes one
transaction at a time. `generate_figma_design` is reserved for capturing a web
page or HTML reference, not for composing kotikit's design-system-grounded
screen states.
```

Update `docs/tools.md` with `CanvasPlan`, `FigmaTransactionPlan`, `FigmaNodeLedger`, and `CanvasReconciliationReport`.

Update `KOTIKIT_MIGRATION.md` with a short section:

```md
### Incremental Figma Apply

Kotikit no longer treats Figma apply as one large write. The graph creates a
canvas plan and transaction queue, then drains the queue through resumable
Figma interrupts. This keeps the canvas clean for designers and gives comment
review a durable node ledger.
```

- [ ] **Step 6: Run docs tests and spelling**

```bash
bun test src/test/tooling-config.test.ts
bun run check:spelling
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/instructions.ts src/mcp/facade/prompts.ts .agents/skills/kotikit-auto/SKILL.md .agents/skills/kotikit-design-review/SKILL.md plugins/codex/kotikit/skills/kotikit/SKILL.md plugins/claude/kotikit/skills/kotikit/SKILL.md README.md docs/workflows.md docs/figma.md docs/tools.md docs/modules/mcp.md docs/troubleshooting.md KOTIKIT_MIGRATION.md src/test/tooling-config.test.ts
git commit -m "docs(figma): document incremental draft apply"
```

---

## Task 10: Remove Stale One-Shot Apply Paths And Verify Cleanliness

**Files:**

- Inspect: `src/core/nodes/draft/index.ts`
- Inspect: `src/core/flows/built-in/*.flow.json`
- Inspect: `docs/**/*.md`
- Inspect: `.agents/skills/**/*.md`
- Inspect: `plugins/**/skills/**/*.md`
- Modify only files proven stale by tests and search.

- [ ] **Step 1: Search for stale one-shot guidance and unused nodes**

Run:

```bash
rg -n "dump all states|one-shot|all states at once|wait-for-apply-metadata|record-apply-metadata|draftScreensIncrementally|generate_figma_design" src docs .agents plugins
```

Expected:

- `wait-for-apply-metadata` and `record-apply-metadata` may remain in review/revision flows that are not transaction based yet.
- `draftScreensIncrementally` should be removed if unused.
- `generate_figma_design` should appear only with guidance that it is not the default kotikit draft composition path.

- [ ] **Step 2: Remove the no-op draft node if unused**

If `rg "draft.draftScreensIncrementally" src/core/flows src/core/nodes` shows only the node definition and tests, remove this node from `src/core/nodes/draft/index.ts`.

Add or update a registry test in `src/core/nodes/test/built-in-node-registry.test.ts`:

```ts
it("does not keep the old no-op incremental draft marker node", () => {
  const registry = createBuiltInNodeRegistry();
  expect(() => registry.get("draft.draftScreensIncrementally")).toThrow();
});
```

- [ ] **Step 3: Run unused-code review**

Run:

```bash
bun run check:unused
```

Expected: review the report. Remove only files/exports that are no longer referenced and are covered by new graph tests. Do not auto-delete broad reports without inspecting the diff.

- [ ] **Step 4: Run targeted tests**

```bash
bun test src/core/nodes/test/built-in-node-registry.test.ts src/core/nodes/draft/test/draft-nodes.test.ts e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit cleanup**

```bash
git add src/core/nodes/draft/index.ts src/core/nodes/test/built-in-node-registry.test.ts
git commit -m "refactor(graph): remove stale one-shot draft markers"
```

If no stale code is removed, skip this commit and record the reviewed `check:unused` result in the final implementation summary.

---

## Task 11: Full Verification And Manual Test Recipe

**Files:**

- Modify: `docs/troubleshooting.md`
- Modify: `docs/workflows.md`

- [ ] **Step 1: Add manual designer QA recipe**

Update `docs/workflows.md` with:

```md
### Manual QA For Generated Figma Drafts

After kotikit creates a draft, verify:

- generated frames are in one clean kotikit Section;
- draft components are in their own zone;
- state frames are same-sized and non-overlapping;
- loading, empty, no-results, error, and permission states replace the affected region;
- important controls use design-system component instances;
- variables/styles are bound where available;
- comments on moved frames still map after comment review starts.
```

Update `docs/troubleshooting.md` with:

```md
## Figma Draft Looks Messy Or Overlapped

Ask kotikit to continue the run so it can run the UI quality gate. If the gate
blocks on canvas overlap, rerun the active Figma transaction or ask kotikit to
reconcile the current canvas before reviewing comments.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
bun test
bun run typecheck
bun run check
bunx biome check src/core/domain/canvas-plan.ts src/core/domain/figma-transaction-plan.ts src/core/domain/canvas-reconciliation.ts src/core/nodes/figma/index.ts src/core/nodes/draft/index.ts src/core/nodes/qa/index.ts src/mcp/facade/tools.ts
```

Expected:

- `bun test`: all tests pass.
- `bun run typecheck`: `tsc --noEmit` passes.
- `bun run check`: Biome changed-file check and cspell pass.
- explicit Biome command: checked files pass with no fixes.

- [ ] **Step 3: Create final commit if docs changed**

```bash
git add docs/workflows.md docs/troubleshooting.md
git commit -m "docs(workflows): add figma draft qa recipe"
```

- [ ] **Step 4: Final branch status**

```bash
git status --short --branch
```

Expected: clean working tree on the current feature branch.

---

## Implementation Notes

- The graph compiler disallows cycles. Do not add manifest loops for transaction application. Use `interrupt.resume = "same-node"` and one queue-draining Figma node.
- Keep `figma.waitForApplyMetadata` and `figma.recordApplyMetadata` until all flows using revision apply have transaction equivalents. Removing them too early would break review/revision flows.
- The first implementation should use deterministic grid placement, not a complex packing engine. A two-column state grid and reserved draft-component lane are enough to solve the current overlap problem.
- Canvas reconciliation should trust stable Figma node ids first. Names are useful labels, not durable identity.
- If a designer deletes a generated node, Kotikit should show a recovery message rather than guess where comments belong.
- Quick mode should still infer and create relevant states automatically. It should not pause after the primary screen unless the state set or component strategy is unsafe or ambiguous.

## Self-Review Checklist

- Spec coverage: incremental apply, non-overlap, canvas reconciliation, comment mapping, component/variable/auto-layout expectations, docs, stale cleanup, and non-technical designer UX are covered.
- Placeholder scan: this plan has no open implementation placeholders.
- Type consistency: schema names are `CanvasPlan/v1`, `FigmaTransactionPlan/v1`, `FigmaNodeLedger/v1`, and `CanvasReconciliationReport/v1`; graph state field names match those schema names in camel case.
- Risk: Task 4 changes runtime interrupt behavior. The plan preserves current defaults for existing `waiting-for-figma` nodes and requires a focused regression test.
