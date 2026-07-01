# Kotikit UX Quality Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add graph-backed UX quality contracts for comment evidence mapping, state-set representation, and draft component lifecycle validation.

**Architecture:** The implementation adds typed Zod contracts, pure domain builders, deterministic LangGraph nodes, flow manifest updates, Figma metadata verification, context durability checks, designer recovery models, QA gates, and docs. Pattern-specific UX decisions live in validated pattern-pack data instead of hardcoded node logic.

**Tech Stack:** Bun, TypeScript strict mode, Zod v4, LangGraphJS runtime wrappers, local Figma REST adapters, existing Kotikit graph facade.

---

## Global Rules For Every Agent

- Read `AGENTS.md` and `docs/coding_guidelines.md` before editing.
- Use Bun for tests and scripts.
- Work test-first for behavior changes.
- Keep changes agent-neutral in core modules.
- Avoid hardcoding screen-specific behavior in node logic. Use typed pattern
  packs and generic domain functions.
- Preserve context durability. New graph behavior must resume from persisted
  state and artifacts without relying on conversation history.
- Keep graph state compact. Store raw Figma, comment, and research payloads as
  artifacts once compact contract artifacts exist.
- Designer-facing blocked states must include a plain-language problem and one
  recommended next action.
- Remove stale code once graph-backed replacements are tested.
- Stage only files touched by the current task.
- Make atomic Conventional Commits after each completed task.
- Run the targeted tests listed in each task before committing.

## Recommended Agent Split

- Agent A: artifact schemas, pattern-pack schemas, UX envelope/state matrix
  domain.
- Agent B: create-screen graph nodes, flow manifest, state representation
  contract.
- Agent C: draft component lifecycle and Figma/QA gates.
- Agent D: comment evidence map and review-comments graph.
- Agent E: context durability, resume, and designer recovery tests.
- Agent F: docs, stale-code cleanup, full verification, and final review.

Agents can run A, C, and D in parallel after this plan is approved. Agent B
depends on Agent A. Agent E depends on Agents A through D. Agent F depends on
all implementation tasks.

## File Map

Create:

- `src/core/domain/ux-pattern-pack.ts`
- `src/core/domain/ux-envelope.ts`
- `src/core/domain/state-representation.ts`
- `src/core/domain/draft-component-lifecycle.ts`
- `src/core/domain/comment-evidence-map.ts`
- `src/core/domain/context-durability.ts`
- `src/core/domain/designer-recovery.ts`
- `src/core/domain/test/ux-envelope.test.ts`
- `src/core/domain/test/state-representation.test.ts`
- `src/core/domain/test/draft-component-lifecycle.test.ts`
- `src/core/domain/test/comment-evidence-map.test.ts`
- `src/core/domain/test/context-durability.test.ts`
- `src/core/domain/test/designer-recovery.test.ts`
- `src/core/graph/test/context-durability.test.ts`
- `src/core/nodes/ux/index.ts`
- `src/core/nodes/ux/test/ux-nodes.test.ts`
- `src/core/nodes/comments/index.ts`
- `src/core/nodes/comments/test/comments-nodes.test.ts`
- `src/core/ux-pattern-packs/admin-data-table.json`
- `src/core/ux-pattern-packs/dashboard-summary.json`
- `src/core/ux-pattern-packs/settings-form.json`
- `src/core/ux-pattern-packs/test/pattern-packs.test.ts`

Modify:

- `src/core/schemas/artifact.ts`
- `src/core/schemas/graph-state.ts`
- `src/core/nodes/built-in-registry.ts`
- `src/core/nodes/ui-composition/index.ts`
- `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
- `src/core/nodes/draft-components/index.ts`
- `src/core/nodes/draft-components/test/draft-component-nodes.test.ts`
- `src/core/nodes/figma/index.ts`
- `src/core/nodes/figma/test/figma-nodes.test.ts`
- `src/core/nodes/qa/index.ts`
- `src/core/nodes/qa/test/qa-nodes.test.ts`
- `src/core/nodes/review/index.ts`
- `src/core/nodes/review/test/review-nodes.test.ts`
- `src/core/flows/built-in/create-screen.flow.json`
- `src/core/flows/built-in/review-comments.flow.json`
- `e2e/graph/create-screen-flow.test.ts`
- `e2e/graph/review-comments-flow.test.ts`
- `docs/workflows.md`
- `docs/figma.md`
- `docs/tools.md`
- `docs/troubleshooting.md`
- `README.md`
- `KOTIKIT_MIGRATION.md`

Potentially remove after replacement coverage exists:

- stale exports or wrappers in `src/planning/design-comments.ts`
- stale exports or wrappers in `src/planning/design-node-map.ts`
- stale tests that validate removed public choreography rather than reusable
  graph-backed domain behavior

---

## Task 1: Add Artifact And State Schemas

**Files:**

- Modify: `src/core/schemas/artifact.ts`
- Modify: `src/core/schemas/graph-state.ts`
- Create: `src/core/schemas/test/ux-quality-artifacts.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `src/core/schemas/test/ux-quality-artifacts.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  CommentEvidenceMapSchema,
  DraftComponentLifecycleSchema,
  StateMatrixSchema,
  UXEnvelopeSchema,
} from "../artifact.js";
import { KotikitGraphStateSchema } from "../graph-state.js";

describe("UX quality artifact schemas", () => {
  it("validates a UX envelope", () => {
    expect(
      UXEnvelopeSchema.parse({
        schemaVersion: "UXEnvelope/v1",
        screenArchetype: "admin-data-table",
        confidence: "inferred",
        actor: "Workspace admin",
        primaryGoal: "Manage workspace members",
        primaryTask: "Review members and invite teammates",
        secondaryTasks: ["Search members", "Filter by role"],
        dataModel: {
          primaryEntity: "member",
          expectedVolume: "many",
          fields: ["name", "role", "status"],
        },
        permissions: ["invite-member", "change-role"],
        edgeCases: ["empty", "loading", "error", "permission"],
        assumptions: ["Admin screens usually need table management states."],
        sourceRefs: ["https://www.nngroup.com/articles/task-analysis/"],
      })
    ).toMatchObject({ schemaVersion: "UXEnvelope/v1" });
  });

  it("validates a region-scoped state matrix", () => {
    expect(
      StateMatrixSchema.parse({
        schemaVersion: "StateMatrix/v1",
        states: [
          {
            id: "members-loading",
            label: "Loading",
            kind: "loading",
            scope: "region",
            affectedRegion: "members table",
            persistentRegions: ["sidebar", "top bar", "page header"],
            replacementBehavior: "replace-table-body",
            requiredComponents: ["table skeleton row"],
            copy: { title: "Loading members" },
            sourceRefs: ["https://carbondesignsystem.com/patterns/empty-states-pattern/"],
          },
        ],
      })
    ).toMatchObject({ states: [expect.objectContaining({ scope: "region" })] });
  });

  it("validates comment evidence with unmapped comments", () => {
    expect(
      CommentEvidenceMapSchema.parse({
        schemaVersion: "CommentEvidenceMap/v1",
        fileKey: "abc123",
        mappedAt: "2026-07-01T00:00:00.000Z",
        comments: [
          {
            commentId: "comment-1",
            rootCommentId: "comment-1",
            message: "This table state is unclear",
            mappingConfidence: "none",
            mappingStrategy: "unmapped",
            intent: "needs-human-clarification",
            status: "needs-human",
          },
        ],
        unmappedCount: 1,
      })
    ).toMatchObject({ unmappedCount: 1 });
  });

  it("validates draft component lifecycle usage", () => {
    expect(
      DraftComponentLifecycleSchema.parse({
        schemaVersion: "DraftComponentLifecycle/v1",
        sectionName: "Kotikit Draft Components",
        components: [
          {
            draftComponentId: "draft-table-row",
            name: "Table data row",
            reason: "No matching design-system component",
            componentKey: "draft-key",
            componentNodeId: "1:2",
            placement: { pageId: "0:1", sectionName: "Kotikit Draft Components" },
            requiredInstances: 1,
            actualInstances: [{ nodeId: "2:1", stateId: "members-filled" }],
            status: "used",
          },
        ],
      })
    ).toMatchObject({ components: [expect.objectContaining({ status: "used" })] });
  });

  it("allows graph state to hold UX quality artifacts", () => {
    expect(
      KotikitGraphStateSchema.parse({
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "running",
        project: { root: "/tmp/project" },
        uxEnvelope: {
          schemaVersion: "UXEnvelope/v1",
          screenArchetype: "unknown",
          confidence: "low",
          actor: "Designer",
          primaryGoal: "Create a screen",
          primaryTask: "Draft UI",
          secondaryTasks: [],
          dataModel: { primaryEntity: "unknown", expectedVolume: "unknown", fields: [] },
          permissions: [],
          edgeCases: [],
          assumptions: [],
          sourceRefs: [],
        },
        stateMatrix: { schemaVersion: "StateMatrix/v1", states: [] },
        artifacts: [],
        errors: [],
      })
    ).toMatchObject({ uxEnvelope: expect.any(Object), stateMatrix: expect.any(Object) });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test src/core/schemas/test/ux-quality-artifacts.test.ts
```

Expected: fail because the new schemas and graph-state fields do not exist.

- [ ] **Step 3: Add artifact schemas**

Modify `src/core/schemas/artifact.ts`:

```ts
export const UXEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("UXEnvelope/v1"),
  screenArchetype: z.enum([
    "admin-data-table",
    "dashboard",
    "settings-form",
    "detail-page",
    "creation-flow",
    "review-workflow",
    "unknown",
  ]),
  confidence: z.enum(["observed", "inferred", "low"]),
  actor: z.string().min(1),
  primaryGoal: z.string().min(1),
  primaryTask: z.string().min(1),
  secondaryTasks: z.array(z.string().min(1)),
  dataModel: z.strictObject({
    primaryEntity: z.string().min(1),
    expectedVolume: z.enum(["zero", "one", "few", "many", "unknown"]),
    fields: z.array(z.string().min(1)),
  }),
  permissions: z.array(z.string().min(1)),
  edgeCases: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().url()),
});

export const StateMatrixStateSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "filled",
    "loading",
    "empty",
    "no-results",
    "error",
    "permission",
    "success",
    "custom",
  ]),
  scope: z.enum(["page", "region", "component", "flow"]),
  affectedRegion: z.string().min(1).optional(),
  persistentRegions: z.array(z.string().min(1)),
  replacementBehavior: z.enum([
    "same-frame-variant",
    "replace-whole-page",
    "replace-region-content",
    "replace-table-body",
    "inline-feedback",
    "blocking-dialog",
  ]),
  requiredComponents: z.array(z.string().min(1)),
  copy: z
    .strictObject({
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    })
    .optional(),
  primaryAction: z.string().min(1).optional(),
  secondaryAction: z.string().min(1).optional(),
  sourceRefs: z.array(z.string().url()),
});

export const StateMatrixSchema = z.strictObject({
  schemaVersion: z.literal("StateMatrix/v1"),
  states: z.array(StateMatrixStateSchema),
});

export const CommentEvidenceMapSchema = z.strictObject({
  schemaVersion: z.literal("CommentEvidenceMap/v1"),
  fileKey: z.string().min(1),
  mappedAt: z.string().min(1),
  comments: z.array(
    z.strictObject({
      commentId: z.string().min(1),
      rootCommentId: z.string().min(1),
      parentId: z.string().min(1).optional(),
      orderId: z.number().optional(),
      message: z.string(),
      author: z.string().min(1).optional(),
      createdAt: z.string().min(1).optional(),
      resolvedAt: z.string().min(1).optional(),
      clientMeta: z.unknown().optional(),
      mappedTarget: z
        .strictObject({
          nodeId: z.string().min(1),
          nodeName: z.string().min(1).optional(),
          partId: z.string().min(1).optional(),
          stateId: z.string().min(1).optional(),
          componentKey: z.string().min(1).optional(),
          draftComponentId: z.string().min(1).optional(),
        })
        .optional(),
      mappingConfidence: z.enum(["exact", "high", "medium", "low", "none"]),
      mappingStrategy: z.enum([
        "node-id",
        "parent-thread",
        "frame-offset",
        "region-overlap",
        "nearest-known-target",
        "unmapped",
      ]),
      intent: z.enum([
        "question",
        "bug-usability",
        "visual-polish",
        "copy-content",
        "design-system-mismatch",
        "implementation-handoff",
        "preference",
        "out-of-scope",
        "needs-human-clarification",
      ]),
      status: z.enum(["actionable", "needs-human", "non-actionable", "resolved"]),
    })
  ),
  unmappedCount: z.number().int().nonnegative(),
});

export const DraftComponentLifecycleSchema = z.strictObject({
  schemaVersion: z.literal("DraftComponentLifecycle/v1"),
  sectionName: z.literal("Kotikit Draft Components"),
  components: z.array(
    z.strictObject({
      draftComponentId: z.string().min(1),
      name: z.string().min(1),
      reason: z.string().min(1),
      componentKey: z.string().min(1).optional(),
      componentNodeId: z.string().min(1).optional(),
      placement: z.strictObject({
        pageId: z.string().min(1).optional(),
        sectionName: z.string().min(1).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      }),
      requiredInstances: z.number().int().nonnegative(),
      actualInstances: z.array(
        z.strictObject({
          nodeId: z.string().min(1),
          stateId: z.string().min(1).optional(),
        })
      ),
      status: z.enum([
        "planned",
        "created",
        "used",
        "unused-approved",
        "orphan-blocked",
        "overlap-blocked",
      ]),
      promotionNote: z.string().min(1).optional(),
    })
  ),
});
```

Also add the new artifact types and schema versions to
`ArtifactTypeSchema`, `ArtifactSchemaVersionByType`, `ArtifactPayloadSchema`,
`ArtifactVariantSchema`, and exported TypeScript types.

- [ ] **Step 4: Add graph-state fields**

Modify `src/core/schemas/graph-state.ts` imports and schema:

```ts
import {
  ArtifactTypeSchema,
  CommentEvidenceMapSchema,
  DraftComponentLifecycleSchema,
  DraftComponentPlanSchema,
  LayoutContractSchema,
  StateMatrixSchema,
  UICompositionContractSchema,
  UIQualityGateReportSchema,
  UXEnvelopeSchema,
  VariableBindingPlanSchema,
} from "./artifact.js";
```

Add optional fields to `KotikitGraphStateSchema`:

```ts
  uxEnvelope: UXEnvelopeSchema.optional(),
  stateMatrix: StateMatrixSchema.optional(),
  commentEvidenceMap: CommentEvidenceMapSchema.optional(),
  draftComponentLifecycle: DraftComponentLifecycleSchema.optional(),
  stateRepresentation: z.unknown().optional(),
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test src/core/schemas/test/ux-quality-artifacts.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/schemas/artifact.ts src/core/schemas/graph-state.ts src/core/schemas/test/ux-quality-artifacts.test.ts
git commit -m "feat(core): add ux quality artifact schemas"
```

---

## Task 2: Add Pattern Packs And UX Envelope Domain

**Files:**

- Create: `src/core/domain/ux-pattern-pack.ts`
- Create: `src/core/domain/ux-envelope.ts`
- Create: `src/core/domain/test/ux-envelope.test.ts`
- Create: `src/core/ux-pattern-packs/admin-data-table.json`
- Create: `src/core/ux-pattern-packs/dashboard-summary.json`
- Create: `src/core/ux-pattern-packs/settings-form.json`
- Create: `src/core/ux-pattern-packs/test/pattern-packs.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `src/core/domain/test/ux-envelope.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildStateMatrix, buildUxEnvelope, classifyScreenArchetype } from "../ux-envelope.js";
import { adminDataTablePatternPack } from "../ux-pattern-pack.js";

describe("UX envelope planning", () => {
  it("classifies admin members as a data-table screen", () => {
    expect(classifyScreenArchetype("Create Admin members page")).toBe("admin-data-table");
  });

  it("builds a source-grounded UX envelope", () => {
    const envelope = buildUxEnvelope({
      userIntent: "Create Admin members page",
      screen: {
        title: "Admin Members",
        requiredUiParts: ["members table", "invite member button"],
        states: ["filled", "loading", "empty", "error"],
      },
    });

    expect(envelope).toMatchObject({
      schemaVersion: "UXEnvelope/v1",
      screenArchetype: "admin-data-table",
      actor: "Workspace admin",
      primaryTask: "Manage members",
    });
    expect(envelope.sourceRefs).toContain("https://www.nngroup.com/articles/task-analysis/");
  });

  it("plans table states as region states instead of cards", () => {
    const matrix = buildStateMatrix({
      envelope: buildUxEnvelope({
        userIntent: "Create Admin members page",
        screen: {
          title: "Admin Members",
          requiredUiParts: ["members table"],
          states: ["filled", "loading", "empty", "no-results", "error", "permission"],
        },
      }),
      patternPack: adminDataTablePatternPack,
    });

    expect(matrix.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loading",
          scope: "region",
          replacementBehavior: "replace-table-body",
        }),
        expect.objectContaining({
          kind: "empty",
          scope: "region",
          replacementBehavior: "replace-region-content",
        }),
        expect.objectContaining({
          kind: "error",
          scope: "region",
          primaryAction: "Retry",
        }),
      ])
    );
  });
});
```

- [ ] **Step 2: Write failing pattern-pack tests**

Create `src/core/ux-pattern-packs/test/pattern-packs.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import adminDataTable from "../admin-data-table.json" with { type: "json" };
import dashboardSummary from "../dashboard-summary.json" with { type: "json" };
import settingsForm from "../settings-form.json" with { type: "json" };
import { UXPatternPackSchema } from "../../domain/ux-pattern-pack.js";

describe("built-in UX pattern packs", () => {
  it.each([adminDataTable, dashboardSummary, settingsForm])(
    "validates %p",
    (pack) => {
      expect(UXPatternPackSchema.parse(pack)).toMatchObject({
        schemaVersion: "UXPatternPack/v1",
      });
    }
  );

  it("keeps data-table state rules region scoped", () => {
    const pack = UXPatternPackSchema.parse(adminDataTable);
    expect(pack.defaultStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "loading", scope: "region" }),
        expect.objectContaining({ kind: "empty", scope: "region" }),
        expect.objectContaining({ kind: "error", scope: "region" }),
      ])
    );
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
bun test src/core/domain/test/ux-envelope.test.ts src/core/ux-pattern-packs/test/pattern-packs.test.ts
```

Expected: fail because the domain files and JSON packs do not exist.

- [ ] **Step 4: Implement pattern-pack schema and loader**

Create `src/core/domain/ux-pattern-pack.ts`:

```ts
import { z } from "zod";
import adminDataTable from "../ux-pattern-packs/admin-data-table.json" with { type: "json" };
import dashboardSummary from "../ux-pattern-packs/dashboard-summary.json" with { type: "json" };
import settingsForm from "../ux-pattern-packs/settings-form.json" with { type: "json" };

export const UXPatternPackStateSchema = z.strictObject({
  kind: z.enum([
    "filled",
    "loading",
    "empty",
    "no-results",
    "error",
    "permission",
    "success",
    "custom",
  ]),
  scope: z.enum(["page", "region", "component", "flow"]),
  affectedRegion: z.string().min(1).optional(),
  replacementBehavior: z.enum([
    "same-frame-variant",
    "replace-whole-page",
    "replace-region-content",
    "replace-table-body",
    "inline-feedback",
    "blocking-dialog",
  ]),
  requiredComponents: z.array(z.string().min(1)),
  primaryAction: z.string().min(1).optional(),
  secondaryAction: z.string().min(1).optional(),
  copy: z
    .strictObject({
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    })
    .optional(),
  sourceRefs: z.array(z.string().url()),
});

export const UXPatternPackSchema = z.strictObject({
  schemaVersion: z.literal("UXPatternPack/v1"),
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  appliesTo: z.array(z.string().min(1)),
  defaultStates: z.array(UXPatternPackStateSchema),
  componentRoles: z.array(z.string().min(1)),
  layoutRules: z.array(z.string().min(1)),
  qaRules: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().url()),
});

export type UXPatternPack = z.infer<typeof UXPatternPackSchema>;

export const adminDataTablePatternPack = UXPatternPackSchema.parse(adminDataTable);

const builtInPatternPacks = [
  adminDataTablePatternPack,
  UXPatternPackSchema.parse(dashboardSummary),
  UXPatternPackSchema.parse(settingsForm),
];

export function selectPatternPack(archetype: string): UXPatternPack {
  return (
    builtInPatternPacks.find((pack) => pack.appliesTo.includes(archetype)) ??
    adminDataTablePatternPack
  );
}
```

- [ ] **Step 5: Add JSON pattern packs**

Create `src/core/ux-pattern-packs/admin-data-table.json`:

```json
{
  "schemaVersion": "UXPatternPack/v1",
  "id": "admin-data-table",
  "version": "1.0.0",
  "title": "Admin Data Table",
  "appliesTo": ["admin-data-table"],
  "defaultStates": [
    {
      "kind": "filled",
      "scope": "page",
      "replacementBehavior": "same-frame-variant",
      "requiredComponents": ["data table", "toolbar", "pagination"],
      "sourceRefs": ["https://www.nngroup.com/articles/task-analysis/"]
    },
    {
      "kind": "loading",
      "scope": "region",
      "affectedRegion": "table",
      "replacementBehavior": "replace-table-body",
      "requiredComponents": ["skeleton row"],
      "copy": { "title": "Loading data" },
      "sourceRefs": ["https://www.nngroup.com/articles/response-times-3-important-limits/"]
    },
    {
      "kind": "empty",
      "scope": "region",
      "affectedRegion": "table",
      "replacementBehavior": "replace-region-content",
      "requiredComponents": ["empty state", "primary action"],
      "primaryAction": "Add item",
      "copy": {
        "title": "No data yet",
        "body": "Add the first item to start using this table."
      },
      "sourceRefs": ["https://carbondesignsystem.com/patterns/empty-states-pattern/"]
    },
    {
      "kind": "no-results",
      "scope": "region",
      "affectedRegion": "table",
      "replacementBehavior": "replace-table-body",
      "requiredComponents": ["empty state"],
      "primaryAction": "Clear filters",
      "copy": {
        "title": "No matching results",
        "body": "Adjust search or filters to see more results."
      },
      "sourceRefs": ["https://carbondesignsystem.com/patterns/empty-states-pattern/"]
    },
    {
      "kind": "error",
      "scope": "region",
      "affectedRegion": "table",
      "replacementBehavior": "replace-region-content",
      "requiredComponents": ["inline error", "retry action"],
      "primaryAction": "Retry",
      "copy": {
        "title": "Data could not load",
        "body": "Try again or check whether the service is available."
      },
      "sourceRefs": ["https://www.nngroup.com/articles/error-message-guidelines/"]
    },
    {
      "kind": "permission",
      "scope": "region",
      "affectedRegion": "table",
      "replacementBehavior": "replace-region-content",
      "requiredComponents": ["permission empty state"],
      "primaryAction": "Request access",
      "copy": {
        "title": "You do not have access",
        "body": "Ask an admin for permission to view or manage this data."
      },
      "sourceRefs": ["https://carbondesignsystem.com/patterns/empty-states-pattern/"]
    }
  ],
  "componentRoles": ["table", "toolbar", "search", "filter", "pagination", "empty state"],
  "layoutRules": ["Use auto layout for shell, toolbar, rows, cells, footer, and state regions."],
  "qaRules": [
    "Do not render state previews as cards when the state scope is page or region.",
    "State variants must preserve stable shell regions unless explicitly approved."
  ],
  "sourceRefs": [
    "https://www.nngroup.com/articles/task-analysis/",
    "https://carbondesignsystem.com/patterns/empty-states-pattern/",
    "https://www.nngroup.com/articles/error-message-guidelines/"
  ]
}
```

Create `src/core/ux-pattern-packs/dashboard-summary.json`:

```json
{
  "schemaVersion": "UXPatternPack/v1",
  "id": "dashboard-summary",
  "version": "1.0.0",
  "title": "Dashboard Summary",
  "appliesTo": ["dashboard"],
  "defaultStates": [
    {
      "kind": "filled",
      "scope": "page",
      "replacementBehavior": "same-frame-variant",
      "requiredComponents": ["metric card", "chart", "activity list"],
      "sourceRefs": ["https://www.nngroup.com/articles/task-analysis/"]
    }
  ],
  "componentRoles": ["metric card", "chart", "activity list"],
  "layoutRules": ["Use auto layout for dashboard sections and repeated metric groups."],
  "qaRules": ["Do not create decorative dashboard cards that are not tied to a user task."],
  "sourceRefs": ["https://www.nngroup.com/articles/task-analysis/"]
}
```

Create `src/core/ux-pattern-packs/settings-form.json`:

```json
{
  "schemaVersion": "UXPatternPack/v1",
  "id": "settings-form",
  "version": "1.0.0",
  "title": "Settings Form",
  "appliesTo": ["settings-form"],
  "defaultStates": [
    {
      "kind": "filled",
      "scope": "page",
      "replacementBehavior": "same-frame-variant",
      "requiredComponents": ["form field", "section header", "save action"],
      "sourceRefs": ["https://www.nngroup.com/articles/task-analysis/"]
    }
  ],
  "componentRoles": ["form field", "section header", "save action"],
  "layoutRules": ["Use auto layout for form sections, fields, help text, and action rows."],
  "qaRules": ["Errors must appear near the field or region that caused them."],
  "sourceRefs": [
    "https://www.nngroup.com/articles/task-analysis/",
    "https://www.nngroup.com/articles/error-message-guidelines/"
  ]
}
```

- [ ] **Step 6: Implement UX envelope and state matrix builders**

Create `src/core/domain/ux-envelope.ts`:

```ts
import type { StateMatrix, UXEnvelope } from "../schemas/artifact.js";
import type { UXPatternPack } from "./ux-pattern-pack.js";

type ScreenLike = {
  title?: unknown;
  requiredUiParts?: unknown;
  states?: unknown;
};

export function classifyScreenArchetype(userIntent: string): UXEnvelope["screenArchetype"] {
  const value = normalize(userIntent);
  if (
    hasAny(value, ["member", "user", "team", "admin"]) &&
    hasAny(value, ["page", "table", "list", "manage"])
  ) {
    return "admin-data-table";
  }
  if (hasAny(value, ["dashboard", "overview", "metrics"])) return "dashboard";
  if (hasAny(value, ["settings", "preferences", "configuration"])) return "settings-form";
  return "unknown";
}

export function buildUxEnvelope(input: {
  userIntent: string;
  screen?: ScreenLike;
}): UXEnvelope {
  const archetype = classifyScreenArchetype(input.userIntent);
  const fields = requiredParts(input.screen).filter((part) =>
    hasAny(normalize(part), ["name", "role", "status", "email", "security", "active"])
  );

  return {
    schemaVersion: "UXEnvelope/v1",
    screenArchetype: archetype,
    confidence: archetype === "unknown" ? "low" : "inferred",
    actor: archetype === "admin-data-table" ? "Workspace admin" : "Designer",
    primaryGoal:
      archetype === "admin-data-table" ? "Manage workspace members" : "Create a product screen",
    primaryTask: archetype === "admin-data-table" ? "Manage members" : "Draft UI",
    secondaryTasks:
      archetype === "admin-data-table"
        ? ["Search records", "Filter records", "Review status", "Use row actions"]
        : [],
    dataModel: {
      primaryEntity: archetype === "admin-data-table" ? "member" : "unknown",
      expectedVolume: archetype === "admin-data-table" ? "many" : "unknown",
      fields,
    },
    permissions: archetype === "admin-data-table" ? ["view", "invite", "edit-role"] : [],
    edgeCases: stateNames(input.screen),
    assumptions:
      archetype === "admin-data-table"
        ? ["Admin data-table screens need filled, loading, empty, no-results, error, and permission states when relevant."]
        : ["Kotikit could not confidently classify the screen archetype."],
    sourceRefs: [
      "https://www.nngroup.com/articles/which-ux-research-methods/",
      "https://www.nngroup.com/articles/task-analysis/",
    ],
  };
}

export function buildStateMatrix(input: {
  envelope: UXEnvelope;
  patternPack: UXPatternPack;
}): StateMatrix {
  const persistentRegions =
    input.envelope.screenArchetype === "admin-data-table"
      ? ["sidebar", "top bar", "page header"]
      : ["page shell"];

  return {
    schemaVersion: "StateMatrix/v1",
    states: input.patternPack.defaultStates.map((state) => ({
      id: `${slug(input.envelope.dataModel.primaryEntity)}-${state.kind}`,
      label: labelFor(state.kind),
      kind: state.kind,
      scope: state.scope,
      affectedRegion: state.affectedRegion ?? input.envelope.dataModel.primaryEntity,
      persistentRegions,
      replacementBehavior: state.replacementBehavior,
      requiredComponents: state.requiredComponents,
      ...(state.copy !== undefined ? { copy: state.copy } : {}),
      ...(state.primaryAction !== undefined ? { primaryAction: state.primaryAction } : {}),
      ...(state.secondaryAction !== undefined ? { secondaryAction: state.secondaryAction } : {}),
      sourceRefs: state.sourceRefs,
    })),
  };
}

function requiredParts(screen: ScreenLike | undefined): string[] {
  return Array.isArray(screen?.requiredUiParts)
    ? screen.requiredUiParts.filter((item): item is string => typeof item === "string")
    : [];
}

function stateNames(screen: ScreenLike | undefined): string[] {
  return Array.isArray(screen?.states)
    ? screen.states.filter((item): item is string => typeof item === "string")
    : [];
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function labelFor(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-") || "screen";
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test src/core/domain/test/ux-envelope.test.ts src/core/ux-pattern-packs/test/pattern-packs.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/domain/ux-pattern-pack.ts src/core/domain/ux-envelope.ts src/core/domain/test/ux-envelope.test.ts src/core/ux-pattern-packs
git commit -m "feat(core): add ux pattern planning"
```

---

## Task 3: Add UX Graph Nodes And Create-Screen Flow Wiring

**Files:**

- Create: `src/core/nodes/ux/index.ts`
- Create: `src/core/nodes/ux/test/ux-nodes.test.ts`
- Modify: `src/core/nodes/built-in-registry.ts`
- Modify: `src/core/flows/built-in/create-screen.flow.json`
- Modify: `e2e/graph/create-screen-flow.test.ts`

- [ ] **Step 1: Write failing node tests**

Create `src/core/nodes/ux/test/ux-nodes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { NodeOutput } from "../../../graph/node-registry.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";

describe("UX graph nodes", () => {
  it("builds a UX envelope from screen intent", async () => {
    const output = await runNode("ux.buildEnvelope", {
      userIntent: "Create Admin members page",
      screen: {
        title: "Members",
        requiredUiParts: ["members table"],
        states: ["filled", "loading", "empty", "error"],
      },
    });

    expect(output.statePatch?.uxEnvelope).toMatchObject({
      schemaVersion: "UXEnvelope/v1",
      screenArchetype: "admin-data-table",
    });
  });

  it("plans a state matrix before UI composition", async () => {
    const envelopeOutput = await runNode("ux.buildEnvelope", {
      userIntent: "Create Admin members page",
      screen: {
        title: "Members",
        requiredUiParts: ["members table"],
        states: ["filled", "loading", "empty", "error"],
      },
    });
    const output = await runNode("ux.planStateMatrix", {
      uxEnvelope: envelopeOutput.statePatch?.uxEnvelope,
    });

    expect(output.statePatch?.stateMatrix).toMatchObject({
      schemaVersion: "StateMatrix/v1",
      states: expect.arrayContaining([
        expect.objectContaining({ kind: "loading", scope: "region" }),
      ]),
    });
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>
): Promise<NodeOutput & { statePatch?: Partial<KotikitGraphState> }> {
  const registry = createBuiltInNodeRegistry();
  const node = registry.get(key);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput & {
    statePatch?: Partial<KotikitGraphState>;
  };
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-ux",
    flowId: "create-screen",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/project" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
```

- [ ] **Step 2: Run failing node tests**

Run:

```bash
bun test src/core/nodes/ux/test/ux-nodes.test.ts
```

Expected: fail because `ux.buildEnvelope` and `ux.planStateMatrix` are not
registered.

- [ ] **Step 3: Implement UX nodes**

Create `src/core/nodes/ux/index.ts`:

```ts
import { z } from "zod";
import { buildStateMatrix, buildUxEnvelope } from "../../domain/ux-envelope.js";
import { selectPatternPack } from "../../domain/ux-pattern-pack.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
};

const EmptyParamsSchema = z.strictObject({});

export const uxNodeDefinitions: NodeDefinition[] = [
  node({
    key: "ux.buildEnvelope",
    stateReads: ["userIntent", "screen"],
    stateWrites: ["uxEnvelope"],
    run: async (input) => {
      const state = graphState(input.state);
      return {
        statePatch: {
          uxEnvelope: buildUxEnvelope({
            userIntent: state.userIntent ?? "Create a product screen.",
            screen: recordFrom(state.screen),
          }),
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
  node({
    key: "ux.planStateMatrix",
    stateReads: ["uxEnvelope"],
    stateWrites: ["stateMatrix"],
    run: async (input) => {
      const state = graphState(input.state);
      const envelope = state.uxEnvelope;
      if (envelope === undefined) {
        throw new Error("UX envelope must be built before planning states.");
      }
      return {
        statePatch: {
          stateMatrix: buildStateMatrix({
            envelope,
            patternPack: selectPatternPack(envelope.screenArchetype),
          }),
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
];

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

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
```

Register nodes in `src/core/nodes/built-in-registry.ts`:

```ts
import { uxNodeDefinitions } from "./ux/index.js";
```

Add `...uxNodeDefinitions` after `...briefNodeDefinitions`.

- [ ] **Step 4: Update create-screen flow**

Modify `src/core/flows/built-in/create-screen.flow.json`:

Add required capabilities:

```json
"ux.plan"
```

Add nodes after `infer-screen-blueprint`:

```json
{
  "id": "build-ux-envelope",
  "uses": "ux.buildEnvelope",
  "params": {}
},
{
  "id": "plan-state-matrix",
  "uses": "ux.planStateMatrix",
  "params": {}
}
```

Update edges:

```json
["infer-screen-blueprint", "build-ux-envelope"],
["build-ux-envelope", "plan-state-matrix"],
["plan-state-matrix", "summarize-brief-for-approval"]
```

Remove the direct edge from `infer-screen-blueprint` to
`summarize-brief-for-approval`.

- [ ] **Step 5: Update e2e graph smoke test**

Modify `e2e/graph/create-screen-flow.test.ts` so the create-screen smoke test
asserts:

```ts
expect(await artifactPayload(runId, "ux-envelope")).toMatchObject({
  schemaVersion: "UXEnvelope/v1",
});
expect(await artifactPayload(runId, "state-matrix")).toMatchObject({
  schemaVersion: "StateMatrix/v1",
});
```

For this task, assert graph state rather than persisted artifacts. Task 8 adds
artifact persistence assertions:

```ts
expect(run.state.uxEnvelope).toMatchObject({ schemaVersion: "UXEnvelope/v1" });
expect(run.state.stateMatrix).toMatchObject({ schemaVersion: "StateMatrix/v1" });
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/core/nodes/ux/test/ux-nodes.test.ts src/core/nodes/test/built-in-node-registry.test.ts e2e/graph/create-screen-flow.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add src/core/nodes/ux src/core/nodes/built-in-registry.ts src/core/flows/built-in/create-screen.flow.json e2e/graph/create-screen-flow.test.ts
git commit -m "feat(graph): plan ux states before screen composition"
```

---

## Task 4: Add State Representation Contract And QA Gates

**Files:**

- Create: `src/core/domain/state-representation.ts`
- Create: `src/core/domain/test/state-representation.test.ts`
- Modify: `src/core/nodes/ui-composition/index.ts`
- Modify: `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
- Modify: `src/core/nodes/figma/index.ts`
- Modify: `src/core/nodes/figma/test/figma-nodes.test.ts`
- Modify: `src/core/domain/ui-quality-gate.ts`
- Modify: `src/core/nodes/qa/test/qa-nodes.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `src/core/domain/test/state-representation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  buildStateRepresentationContract,
  verifyStateRepresentationMetadata,
} from "../state-representation.js";

describe("state representation contract", () => {
  const stateMatrix = {
    schemaVersion: "StateMatrix/v1" as const,
    states: [
      {
        id: "members-loading",
        label: "Loading",
        kind: "loading" as const,
        scope: "region" as const,
        affectedRegion: "members table",
        persistentRegions: ["sidebar", "top bar"],
        replacementBehavior: "replace-table-body" as const,
        requiredComponents: ["skeleton row"],
        sourceRefs: ["https://carbondesignsystem.com/patterns/empty-states-pattern/"],
      },
    ],
  };

  it("builds expected state frame metadata", () => {
    expect(buildStateRepresentationContract({ stateMatrix })).toMatchObject({
      schemaVersion: "StateRepresentationContract/v1",
      states: [
        expect.objectContaining({
          stateId: "members-loading",
          representation: "region-state",
        }),
      ],
    });
  });

  it("rejects state preview cards for region states", () => {
    expect(() =>
      verifyStateRepresentationMetadata({
        contract: buildStateRepresentationContract({ stateMatrix }),
        appliedStates: [
          {
            stateId: "members-loading",
            representation: "preview-card",
            width: 320,
            height: 120,
          },
        ],
      })
    ).toThrow(KotikitError);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
bun test src/core/domain/test/state-representation.test.ts
```

Expected: fail because the domain file does not exist.

- [ ] **Step 3: Implement state representation domain**

Create `src/core/domain/state-representation.ts`:

```ts
import { KotikitError } from "../../util/result.js";
import type { StateMatrix } from "../schemas/artifact.js";

export type StateRepresentationContract = {
  schemaVersion: "StateRepresentationContract/v1";
  states: {
    stateId: string;
    kind: string;
    scope: "page" | "region" | "component" | "flow";
    representation: "screen-frame" | "region-state" | "component-state" | "flow-step";
    replacementBehavior: string;
    persistentRegions: string[];
  }[];
};

type AppliedState = {
  stateId?: unknown;
  representation?: unknown;
  width?: unknown;
  height?: unknown;
  persistentRegions?: unknown;
};

export function buildStateRepresentationContract(input: {
  stateMatrix: StateMatrix;
}): StateRepresentationContract {
  return {
    schemaVersion: "StateRepresentationContract/v1",
    states: input.stateMatrix.states.map((state) => ({
      stateId: state.id,
      kind: state.kind,
      scope: state.scope,
      representation: representationFor(state.scope),
      replacementBehavior: state.replacementBehavior,
      persistentRegions: state.persistentRegions,
    })),
  };
}

export function verifyStateRepresentationMetadata(input: {
  contract: StateRepresentationContract;
  appliedStates: AppliedState[];
}): void {
  input.contract.states.forEach((expected) => {
    const applied = input.appliedStates.find((state) => state.stateId === expected.stateId);
    if (applied === undefined) {
      throw new KotikitError(
        `The applied Figma draft is missing the ${expected.kind} state.`,
        "Create every state recorded in the state matrix before marking the draft complete."
      );
    }
    if (applied.representation === "preview-card" && expected.scope !== "component") {
      throw new KotikitError(
        `The ${expected.kind} state was created as a preview card instead of a ${expected.scope} state.`,
        "Represent loading, empty, and error as page or region states when the state matrix requires it."
      );
    }
    if (applied.representation !== expected.representation) {
      throw new KotikitError(
        `The ${expected.kind} state has the wrong Figma representation.`,
        `Expected ${expected.representation} based on the state matrix.`
      );
    }
  });
}

function representationFor(
  scope: "page" | "region" | "component" | "flow"
): StateRepresentationContract["states"][number]["representation"] {
  if (scope === "page") return "screen-frame";
  if (scope === "region") return "region-state";
  if (scope === "component") return "component-state";
  return "flow-step";
}
```

- [ ] **Step 4: Add graph node**

Modify `src/core/nodes/ui-composition/index.ts`:

```ts
import {
  buildStateRepresentationContract,
  verifyStateRepresentationMetadata,
} from "../../domain/state-representation.js";
```

Add nodes:

```ts
node({
  key: "ui.buildStateRepresentationContract",
  stateReads: ["stateMatrix"],
  stateWrites: ["stateRepresentation"],
  run: async (input) => {
    const state = graphState(input.state);
    if (state.stateMatrix === undefined) {
      throw new KotikitError(
        "The state matrix has not been planned yet.",
        "Plan UX states before composing high-fidelity screens."
      );
    }
    return {
      statePatch: {
        stateRepresentation: buildStateRepresentationContract({
          stateMatrix: state.stateMatrix,
        }),
      },
    } satisfies RuntimeNodeOutput;
  },
}),
node({
  key: "ui.verifyStateRepresentation",
  stateReads: ["stateRepresentation", "applyReport"],
  stateWrites: [],
  run: async (input) => {
    const state = graphState(input.state);
    verifyStateRepresentationMetadata({
      contract: recordFrom(state).stateRepresentation as ReturnType<
        typeof buildStateRepresentationContract
      >,
      appliedStates: recordArray(recordFrom(state.applyReport).states),
    });
    return {} satisfies RuntimeNodeOutput;
  },
}),
```

The `stateRepresentation` graph-state field was added in Task 1 as an
unstructured compatibility field. This task is responsible for writing and
verifying its shape through the domain contract.

- [ ] **Step 5: Update create-screen flow**

Modify `src/core/flows/built-in/create-screen.flow.json`:

Add node after `build-ui-composition-contract`:

```json
{
  "id": "build-state-representation-contract",
  "uses": "ui.buildStateRepresentationContract",
  "params": {}
}
```

Add node after `verify-draft-invariants`:

```json
{
  "id": "verify-state-representation",
  "uses": "ui.verifyStateRepresentation",
  "params": {}
}
```

Update edges so layout follows `build-state-representation-contract`, and
`save-apply-report` follows `verify-state-representation`.

- [ ] **Step 6: Extend apply report metadata**

Modify `src/core/nodes/figma/index.ts` in `figma.recordApplyMetadata` so
`applyReport` includes:

```ts
states: recordArray(metadata.states),
```

Modify `figma.saveApplyReport` so payload data includes:

```ts
states: toJson(recordArray(report.states)),
```

- [ ] **Step 7: Add QA gate checks**

Modify `src/core/domain/ui-quality-gate.ts` checks:

```ts
check(
  "state-preview-card",
  "State preview cards",
  input.nodes,
  (node) => node.statePreviewCard === true
),
check(
  "missing-state-frame",
  "Missing state frame",
  input.nodes,
  (node) => node.expectedStateFrame === true && node.stateFrameNodeId === undefined
),
check(
  "state-shell-drift",
  "State shell drift",
  input.nodes,
  (node) => node.stateShellDrift === true
),
```

- [ ] **Step 8: Run tests**

Run:

```bash
bun test src/core/domain/test/state-representation.test.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/nodes/qa/test/qa-nodes.test.ts e2e/graph/create-screen-flow.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/domain/state-representation.ts src/core/domain/test/state-representation.test.ts src/core/nodes/ui-composition/index.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/nodes/figma/index.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/domain/ui-quality-gate.ts src/core/nodes/qa/test/qa-nodes.test.ts src/core/flows/built-in/create-screen.flow.json e2e/graph/create-screen-flow.test.ts
git commit -m "feat(core): enforce state representation contracts"
```

---

## Task 5: Add Draft Component Lifecycle Gate

**Files:**

- Create: `src/core/domain/draft-component-lifecycle.ts`
- Create: `src/core/domain/test/draft-component-lifecycle.test.ts`
- Modify: `src/core/nodes/draft-components/index.ts`
- Modify: `src/core/nodes/draft-components/test/draft-component-nodes.test.ts`
- Modify: `src/core/nodes/figma/index.ts`
- Modify: `src/core/nodes/figma/test/figma-nodes.test.ts`
- Modify: `src/core/domain/ui-quality-gate.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create `src/core/domain/test/draft-component-lifecycle.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  buildDraftComponentLifecycle,
  verifyDraftComponentLifecycle,
} from "../draft-component-lifecycle.js";

describe("draft component lifecycle", () => {
  it("marks created draft components as used when instances exist", () => {
    const lifecycle = buildDraftComponentLifecycle({
      plan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-table-row", name: "Table row", reason: "Missing" }],
      },
      createdDraftComponents: [
        { id: "draft-table-row", name: "Table row", componentKey: "component-key", nodeId: "1:2" },
      ],
      appliedInstances: [{ draftComponentId: "draft-table-row", nodeId: "2:1" }],
    });

    expect(lifecycle.components).toEqual([
      expect.objectContaining({
        draftComponentId: "draft-table-row",
        status: "used",
        requiredInstances: 1,
      }),
    ]);
  });

  it("blocks orphan draft components", () => {
    const lifecycle = buildDraftComponentLifecycle({
      plan: {
        schemaVersion: "DraftComponentPlan/v1",
        sectionName: "Kotikit Draft Components",
        components: [{ id: "draft-table-row", name: "Table row", reason: "Missing" }],
      },
      createdDraftComponents: [
        { id: "draft-table-row", name: "Table row", componentKey: "component-key", nodeId: "1:2" },
      ],
      appliedInstances: [],
    });

    expect(() => verifyDraftComponentLifecycle(lifecycle)).toThrow(KotikitError);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test src/core/domain/test/draft-component-lifecycle.test.ts
```

Expected: fail because the domain file does not exist.

- [ ] **Step 3: Implement lifecycle domain**

Create `src/core/domain/draft-component-lifecycle.ts`:

```ts
import { KotikitError } from "../../util/result.js";
import type { DraftComponentLifecycle, DraftComponentPlan } from "../schemas/artifact.js";

type CreatedDraftComponent = {
  id?: unknown;
  name?: unknown;
  componentKey?: unknown;
  nodeId?: unknown;
};

type AppliedInstance = {
  draftComponentId?: unknown;
  nodeId?: unknown;
  stateId?: unknown;
};

export function buildDraftComponentLifecycle(input: {
  plan: DraftComponentPlan;
  createdDraftComponents: CreatedDraftComponent[];
  appliedInstances: AppliedInstance[];
}): DraftComponentLifecycle {
  return {
    schemaVersion: "DraftComponentLifecycle/v1",
    sectionName: "Kotikit Draft Components",
    components: input.plan.components.map((component) => {
      const created = input.createdDraftComponents.find((item) => item.id === component.id);
      const instances = input.appliedInstances.filter(
        (instance) => instance.draftComponentId === component.id && typeof instance.nodeId === "string"
      );
      return {
        draftComponentId: component.id,
        name: component.name,
        reason: component.reason,
        ...(typeof created?.componentKey === "string"
          ? { componentKey: created.componentKey }
          : {}),
        ...(typeof created?.nodeId === "string" ? { componentNodeId: created.nodeId } : {}),
        placement: { sectionName: "Kotikit Draft Components" },
        requiredInstances: 1,
        actualInstances: instances.map((instance) => ({
          nodeId: String(instance.nodeId),
          ...(typeof instance.stateId === "string" ? { stateId: instance.stateId } : {}),
        })),
        status: instances.length > 0 ? "used" : "orphan-blocked",
      };
    }),
  };
}

export function verifyDraftComponentLifecycle(lifecycle: DraftComponentLifecycle): void {
  const orphan = lifecycle.components.find((component) => component.status === "orphan-blocked");
  if (orphan !== undefined) {
    throw new KotikitError(
      `Draft component "${orphan.name}" was created but not used in the generated design.`,
      "Use an instance of every created draft component, or explicitly approve keeping it unused."
    );
  }

  const overlap = lifecycle.components.find((component) => component.status === "overlap-blocked");
  if (overlap !== undefined) {
    throw new KotikitError(
      `Draft component "${overlap.name}" overlaps the generated screen.`,
      "Move draft components into the reserved Kotikit Draft Components area before continuing."
    );
  }
}
```

- [ ] **Step 4: Add graph nodes**

Modify `src/core/nodes/draft-components/index.ts` to add:

```ts
node({
  key: "draftComponents.buildLifecycle",
  stateReads: ["draftComponentPlan", "draftPlan", "applyReport"],
  stateWrites: ["draftComponentLifecycle"],
  run: async (input) => {
    const state = graphState(input.state);
    if (state.draftComponentPlan === undefined) {
      return {} satisfies RuntimeNodeOutput;
    }
    return {
      statePatch: {
        draftComponentLifecycle: buildDraftComponentLifecycle({
          plan: state.draftComponentPlan,
          createdDraftComponents: recordArray(recordFrom(state.draftPlan).createdDraftComponents),
          appliedInstances: recordArray(recordFrom(state.applyReport).draftComponentInstances),
        }),
      },
    } satisfies RuntimeNodeOutput;
  },
}),
node({
  key: "draftComponents.verifyLifecycle",
  stateReads: ["draftComponentLifecycle"],
  stateWrites: [],
  run: async (input) => {
    const lifecycle = graphState(input.state).draftComponentLifecycle;
    if (lifecycle !== undefined) verifyDraftComponentLifecycle(lifecycle);
    return {} satisfies RuntimeNodeOutput;
  },
}),
```

Import domain helpers at the top of the file.

- [ ] **Step 5: Extend apply metadata**

Modify `src/core/nodes/figma/index.ts` so `applyReport` stores:

```ts
draftComponentInstances: recordArray(metadata.draftComponentInstances),
draftComponentPlacements: recordArray(metadata.draftComponentPlacements),
```

Save those fields in `figma.saveApplyReport` payload data.

- [ ] **Step 6: Update create-screen flow**

Modify `src/core/flows/built-in/create-screen.flow.json`:

Add `draftComponents.buildLifecycle` after `record-apply-metadata`.

Add `draftComponents.verifyLifecycle` after `verify-state-representation`.

- [ ] **Step 7: Add QA checks**

Modify `src/core/domain/ui-quality-gate.ts`:

```ts
check(
  "orphan-draft-component",
  "Orphan draft component",
  input.nodes,
  (node) => node.orphanDraftComponent === true
),
check(
  "draft-component-overlap",
  "Draft component overlap",
  input.nodes,
  (node) => node.draftComponentOverlap === true
),
check(
  "draft-component-detached-use",
  "Draft component detached use",
  input.nodes,
  (node) => node.draftComponentDetachedUse === true
),
```

- [ ] **Step 8: Run tests**

Run:

```bash
bun test src/core/domain/test/draft-component-lifecycle.test.ts src/core/nodes/draft-components/test/draft-component-nodes.test.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/nodes/qa/test/qa-nodes.test.ts e2e/graph/create-screen-flow.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/domain/draft-component-lifecycle.ts src/core/domain/test/draft-component-lifecycle.test.ts src/core/nodes/draft-components/index.ts src/core/nodes/draft-components/test/draft-component-nodes.test.ts src/core/nodes/figma/index.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/domain/ui-quality-gate.ts src/core/nodes/qa/test/qa-nodes.test.ts src/core/flows/built-in/create-screen.flow.json e2e/graph/create-screen-flow.test.ts
git commit -m "feat(core): validate draft component lifecycle"
```

---

## Task 6: Add Comment Evidence Map Domain

**Files:**

- Create: `src/core/domain/comment-evidence-map.ts`
- Create: `src/core/domain/test/comment-evidence-map.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/core/domain/test/comment-evidence-map.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildCommentEvidenceMap } from "../comment-evidence-map.js";

describe("comment evidence map", () => {
  const nodeMap = {
    fileKey: "file-1",
    nodes: [
      {
        nodeId: "1:2",
        nodeName: "Members table",
        partId: "members-table",
        componentKey: "table-key",
      },
    ],
  };

  it("maps comments by client_meta node id", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "comment-1",
          message: "Table loading state is missing",
          client_meta: { node_id: "1:2" },
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments[0]).toMatchObject({
      commentId: "comment-1",
      mappingStrategy: "node-id",
      mappingConfidence: "exact",
      mappedTarget: { nodeId: "1:2", partId: "members-table" },
      intent: "bug-usability",
    });
  });

  it("inherits target from parent comment replies", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [
        {
          id: "root",
          message: "Review this table",
          client_meta: { node_id: "1:2" },
        },
        {
          id: "reply",
          parent_id: "root",
          message: "Agree",
        },
      ],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map.comments.find((comment) => comment.commentId === "reply")).toMatchObject({
      mappingStrategy: "parent-thread",
      mappedTarget: { nodeId: "1:2" },
    });
  });

  it("keeps unmapped comments explicit", () => {
    const map = buildCommentEvidenceMap({
      fileKey: "file-1",
      comments: [{ id: "comment-2", message: "What about the states?" }],
      nodeMap,
      mappedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(map).toMatchObject({
      unmappedCount: 1,
      comments: [
        expect.objectContaining({
          mappingStrategy: "unmapped",
          mappingConfidence: "none",
          status: "needs-human",
        }),
      ],
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test src/core/domain/test/comment-evidence-map.test.ts
```

Expected: fail because the domain file does not exist.

- [ ] **Step 3: Implement comment evidence map**

Create `src/core/domain/comment-evidence-map.ts`:

```ts
import type { CommentEvidenceMap } from "../schemas/artifact.js";

type FigmaCommentLike = {
  id?: unknown;
  message?: unknown;
  parent_id?: unknown;
  order_id?: unknown;
  user?: unknown;
  created_at?: unknown;
  resolved_at?: unknown;
  client_meta?: unknown;
};

type NodeMapLike = {
  fileKey?: unknown;
  nodes?: unknown;
};

type NodeTarget = {
  nodeId: string;
  nodeName?: string;
  partId?: string;
  stateId?: string;
  componentKey?: string;
  draftComponentId?: string;
};

export function buildCommentEvidenceMap(input: {
  fileKey: string;
  comments: FigmaCommentLike[];
  nodeMap: NodeMapLike;
  mappedAt: string;
  includeResolved?: boolean;
}): CommentEvidenceMap {
  const nodeTargets = new Map(
    nodeTargetsFrom(input.nodeMap).map((target) => [target.nodeId, target])
  );
  const commentsById = new Map(
    input.comments
      .filter((comment) => typeof comment.id === "string")
      .map((comment) => [String(comment.id), comment])
  );

  const mappedComments = input.comments
    .filter((comment) => input.includeResolved === true || typeof comment.resolved_at !== "string")
    .map((comment) =>
      mapComment({
        comment,
        commentsById,
        nodeTargets,
      })
    );

  return {
    schemaVersion: "CommentEvidenceMap/v1",
    fileKey: input.fileKey,
    mappedAt: input.mappedAt,
    comments: mappedComments,
    unmappedCount: mappedComments.filter((comment) => comment.mappingStrategy === "unmapped")
      .length,
  };
}

function mapComment(input: {
  comment: FigmaCommentLike;
  commentsById: Map<string, FigmaCommentLike>;
  nodeTargets: Map<string, NodeTarget>;
}): CommentEvidenceMap["comments"][number] {
  const commentId = stringField(input.comment, "id") ?? "unknown-comment";
  const directNodeId = nodeIdFromClientMeta(input.comment.client_meta);
  const directTarget = directNodeId === undefined ? undefined : input.nodeTargets.get(directNodeId);
  if (directTarget !== undefined) {
    return commentRecord(input.comment, directTarget, "node-id", "exact");
  }

  const parentId = stringField(input.comment, "parent_id");
  const parent = parentId === undefined ? undefined : input.commentsById.get(parentId);
  const parentNodeId = parent === undefined ? undefined : nodeIdFromClientMeta(parent.client_meta);
  const parentTarget = parentNodeId === undefined ? undefined : input.nodeTargets.get(parentNodeId);
  if (parentTarget !== undefined) {
    return commentRecord(input.comment, parentTarget, "parent-thread", "high");
  }

  return {
    commentId,
    rootCommentId: parentId ?? commentId,
    ...(parentId !== undefined ? { parentId } : {}),
    message: stringField(input.comment, "message") ?? "",
    ...(numberField(input.comment, "order_id") !== undefined
      ? { orderId: numberField(input.comment, "order_id") }
      : {}),
    ...(stringField(input.comment, "created_at") !== undefined
      ? { createdAt: stringField(input.comment, "created_at") }
      : {}),
    ...(stringField(input.comment, "resolved_at") !== undefined
      ? { resolvedAt: stringField(input.comment, "resolved_at") }
      : {}),
    ...(input.comment.client_meta !== undefined ? { clientMeta: input.comment.client_meta } : {}),
    mappingConfidence: "none",
    mappingStrategy: "unmapped",
    intent: "needs-human-clarification",
    status: "needs-human",
  };
}

function commentRecord(
  comment: FigmaCommentLike,
  target: NodeTarget,
  strategy: "node-id" | "parent-thread",
  confidence: "exact" | "high"
): CommentEvidenceMap["comments"][number] {
  const commentId = stringField(comment, "id") ?? "unknown-comment";
  const parentId = stringField(comment, "parent_id");
  return {
    commentId,
    rootCommentId: parentId ?? commentId,
    ...(parentId !== undefined ? { parentId } : {}),
    message: stringField(comment, "message") ?? "",
    mappedTarget: target,
    mappingConfidence: confidence,
    mappingStrategy: strategy,
    intent: classifyIntent(stringField(comment, "message") ?? ""),
    status: stringField(comment, "resolved_at") === undefined ? "actionable" : "resolved",
    ...(numberField(comment, "order_id") !== undefined ? { orderId: numberField(comment, "order_id") } : {}),
    ...(stringField(comment, "created_at") !== undefined ? { createdAt: stringField(comment, "created_at") } : {}),
    ...(stringField(comment, "resolved_at") !== undefined ? { resolvedAt: stringField(comment, "resolved_at") } : {}),
    ...(comment.client_meta !== undefined ? { clientMeta: comment.client_meta } : {}),
  };
}

function nodeTargetsFrom(nodeMap: NodeMapLike): NodeTarget[] {
  return Array.isArray(nodeMap.nodes)
    ? nodeMap.nodes.flatMap((node) => {
        if (typeof node !== "object" || node === null || Array.isArray(node)) return [];
        const record = node as Record<string, unknown>;
        const nodeId = stringField(record, "nodeId");
        if (nodeId === undefined) return [];
        return [
          {
            nodeId,
            ...(stringField(record, "nodeName") !== undefined ? { nodeName: stringField(record, "nodeName") } : {}),
            ...(stringField(record, "partId") !== undefined ? { partId: stringField(record, "partId") } : {}),
            ...(stringField(record, "stateId") !== undefined ? { stateId: stringField(record, "stateId") } : {}),
            ...(stringField(record, "componentKey") !== undefined ? { componentKey: stringField(record, "componentKey") } : {}),
            ...(stringField(record, "draftComponentId") !== undefined ? { draftComponentId: stringField(record, "draftComponentId") } : {}),
          },
        ];
      })
    : [];
}

function nodeIdFromClientMeta(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? stringField(value as Record<string, unknown>, "node_id")
    : undefined;
}

function classifyIntent(message: string): CommentEvidenceMap["comments"][number]["intent"] {
  const value = message.toLowerCase();
  if (value.includes("?")) return "question";
  if (value.includes("component") || value.includes("token")) return "design-system-mismatch";
  if (value.includes("copy") || value.includes("text")) return "copy-content";
  if (value.includes("missing") || value.includes("broken") || value.includes("unclear")) {
    return "bug-usability";
  }
  return "visual-polish";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === "number" ? record[key] : undefined;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test src/core/domain/test/comment-evidence-map.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add src/core/domain/comment-evidence-map.ts src/core/domain/test/comment-evidence-map.test.ts
git commit -m "feat(core): add comment evidence mapping"
```

---

## Task 7: Add Comment Graph Nodes And Review Flow Wiring

**Files:**

- Create: `src/core/nodes/comments/index.ts`
- Create: `src/core/nodes/comments/test/comments-nodes.test.ts`
- Modify: `src/core/nodes/built-in-registry.ts`
- Modify: `src/core/nodes/review/index.ts`
- Modify: `src/core/nodes/review/test/review-nodes.test.ts`
- Modify: `src/core/flows/built-in/review-comments.flow.json`
- Modify: `e2e/graph/review-comments-flow.test.ts`

- [ ] **Step 1: Write failing comment node tests**

Create `src/core/nodes/comments/test/comments-nodes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { NodeOutput } from "../../../graph/node-registry.js";
import { createBuiltInNodeRegistry } from "../../built-in-registry.js";
import type { KotikitGraphState } from "../../../schemas/graph-state.js";

describe("comment graph nodes", () => {
  it("builds evidence map from seeded REST snapshot and apply metadata", async () => {
    const output = await runNode("comments.buildEvidenceMap", {
      review: {
        commentSnapshot: {
          fileKey: "file-1",
          comments: [
            {
              id: "comment-1",
              message: "Loading state is missing",
              client_meta: { node_id: "1:2" },
            },
          ],
        },
      },
      applyReport: {
        fileKey: "file-1",
        nodes: [
          {
            nodeId: "1:2",
            nodeName: "Members table",
            partId: "members-table",
          },
        ],
      },
    });

    expect(output.statePatch?.commentEvidenceMap).toMatchObject({
      schemaVersion: "CommentEvidenceMap/v1",
      comments: [expect.objectContaining({ mappingStrategy: "node-id" })],
    });
  });
});

async function runNode(
  key: string,
  patch: Partial<KotikitGraphState>
): Promise<NodeOutput & { statePatch?: Partial<KotikitGraphState> }> {
  const registry = createBuiltInNodeRegistry();
  const node = registry.get(key);
  return (await node.run({ nodeId: key, params: {}, state: state(patch) })) as NodeOutput & {
    statePatch?: Partial<KotikitGraphState>;
  };
}

function state(patch: Partial<KotikitGraphState>): KotikitGraphState {
  return {
    schemaVersion: "KotikitGraphState/v1",
    runId: "run-comments",
    flowId: "review-comments",
    flowVersion: "1.0.0",
    graphHash: "hash",
    status: "running",
    project: { root: "/tmp/project" },
    artifacts: [],
    errors: [],
    ...patch,
  };
}
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test src/core/nodes/comments/test/comments-nodes.test.ts
```

Expected: fail because comment nodes are not registered.

- [ ] **Step 3: Implement comment node**

Create `src/core/nodes/comments/index.ts`:

```ts
import { z } from "zod";
import { nowIso } from "../../../util/ids.js";
import { KotikitError } from "../../../util/result.js";
import { buildCommentEvidenceMap } from "../../domain/comment-evidence-map.js";
import type { NodeDefinition } from "../../graph/node-registry.js";
import type { KotikitGraphState } from "../../schemas/graph-state.js";

type RuntimeNodeOutput = {
  statePatch?: Partial<KotikitGraphState>;
};

const EmptyParamsSchema = z.strictObject({});

export const commentNodeDefinitions: NodeDefinition[] = [
  node({
    key: "comments.buildEvidenceMap",
    stateReads: ["review", "applyReport"],
    stateWrites: ["commentEvidenceMap", "review"],
    requiredCapabilities: ["comments.read"],
    run: async (input) => {
      const state = graphState(input.state);
      const review = recordFrom(state.review);
      const snapshot = recordFrom(review.commentSnapshot);
      const comments = recordArray(snapshot.comments);
      const fileKey = stringField(snapshot, "fileKey") ?? stringField(recordFrom(state.applyReport), "fileKey");
      if (fileKey === undefined) {
        throw new KotikitError(
          "Kotikit could not find a Figma file key for comment review.",
          "Start the comment review from a Figma file URL or provide a seeded comment snapshot."
        );
      }
      const nodeMap = {
        fileKey,
        nodes: recordArray(recordFrom(state.applyReport).nodes),
      };
      const commentEvidenceMap = buildCommentEvidenceMap({
        fileKey,
        comments,
        nodeMap,
        mappedAt: nowIso(),
      });
      return {
        statePatch: {
          commentEvidenceMap,
          review: { ...review, commentEvidenceMap },
        },
      } satisfies RuntimeNodeOutput;
    },
  }),
];

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

function graphState(value: unknown): KotikitGraphState {
  return value as KotikitGraphState;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}
```

Register `commentNodeDefinitions` in `src/core/nodes/built-in-registry.ts`.

- [ ] **Step 4: Update review collection to consume CommentEvidenceMap**

Modify `src/core/nodes/review/index.ts` so `collectCommentEvidence` reads
`state.commentEvidenceMap` first and no longer calls `ensureDraftTarget`.

Use this behavior:

```ts
const evidenceMap = state.commentEvidenceMap;
if (evidenceMap === undefined) {
  throw new KotikitError(
    "This review-comments flow needs mapped comment evidence.",
    "Build the comment evidence map from Figma comments before grouping findings."
  );
}
```

Build regions from `evidenceMap.comments` with `mappedTarget`. Build findings
from mapped actionable comments. Keep unmapped comments in `review.unmappedComments`
and give them severity `medium` with confidence `needs-decision`.

- [ ] **Step 5: Update review-comments flow**

Modify `src/core/flows/built-in/review-comments.flow.json`:

Remove `ensure-draft-target` from the start.

Add first node:

```json
{
  "id": "build-comment-evidence-map",
  "uses": "comments.buildEvidenceMap",
  "params": {}
}
```

Set start to `build-comment-evidence-map`.

Set edge:

```json
["build-comment-evidence-map", "collect-evidence"]
```

Keep approval, save session, prepare comments, memory detection, and memory
approval unchanged.

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/core/nodes/comments/test/comments-nodes.test.ts src/core/nodes/review/test/review-nodes.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/nodes/comments src/core/nodes/built-in-registry.ts src/core/nodes/review/index.ts src/core/nodes/review/test/review-nodes.test.ts src/core/flows/built-in/review-comments.flow.json e2e/graph/review-comments-flow.test.ts
git commit -m "feat(graph): map figma comments before review planning"
```

---

## Task 8: Persist New Artifacts

**Files:**

- Modify: `src/core/nodes/ux/index.ts`
- Modify: `src/core/nodes/comments/index.ts`
- Modify: `src/core/nodes/draft-components/index.ts`
- Modify: `src/core/runs/test/artifact-store.test.ts`
- Modify: `e2e/graph/create-screen-flow.test.ts`
- Modify: `e2e/graph/review-comments-flow.test.ts`

- [ ] **Step 1: Write failing e2e artifact assertions**

In `e2e/graph/create-screen-flow.test.ts`, assert persisted artifacts include:

```ts
expect(artifactTypes).toContain("ux-envelope");
expect(artifactTypes).toContain("state-matrix");
expect(artifactTypes).toContain("draft-component-lifecycle");
```

In `e2e/graph/review-comments-flow.test.ts`, assert:

```ts
expect(artifactTypes).toContain("comment-evidence-map");
```

- [ ] **Step 2: Run failing e2e tests**

Run:

```bash
bun test e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: fail because the artifacts are only in graph state.

- [ ] **Step 3: Add save nodes or artifact output**

Prefer artifact output from existing nodes to avoid extra graph steps.

For `ux.buildEnvelope`, return an artifact:

```ts
const artifact: Artifact = {
  id: `${state.runId}-ux-envelope`,
  runId: state.runId,
  type: "ux-envelope",
  schemaVersion: ArtifactSchemaVersionByType["ux-envelope"],
  createdAt: nowIso(),
  updatedAt: nowIso(),
  sourceNode: { key: "ux.buildEnvelope", version: "1.0.0" },
  payload: uxEnvelope,
};
```

For `ux.planStateMatrix`, return an artifact with id
`${state.runId}-state-matrix`.

For `comments.buildEvidenceMap`, return an artifact with id
`${state.runId}-comment-evidence-map`.

For `draftComponents.buildLifecycle`, return an artifact with id
`${state.runId}-draft-component-lifecycle`.

Import `Artifact`, `ArtifactSchemaVersionByType`, and `nowIso` where needed.

- [ ] **Step 4: Run e2e tests**

Run:

```bash
bun test e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/nodes/ux/index.ts src/core/nodes/comments/index.ts src/core/nodes/draft-components/index.ts src/core/runs/test/artifact-store.test.ts e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
git commit -m "feat(graph): persist ux quality artifacts"
```

---

## Task 9: Add Context Durability, Resume, And Recovery Tests

**Files:**

- Create: `src/core/domain/context-durability.ts`
- Create: `src/core/domain/designer-recovery.ts`
- Create: `src/core/domain/test/context-durability.test.ts`
- Create: `src/core/domain/test/designer-recovery.test.ts`
- Create: `src/core/graph/test/context-durability.test.ts`
- Modify: `src/core/graph/runtime.ts`
- Modify: `src/core/nodes/comments/index.ts`
- Modify: `e2e/graph/create-screen-flow.test.ts`
- Modify: `e2e/graph/review-comments-flow.test.ts`

- [x] **Step 1: Write failing context budget tests**

Create `src/core/domain/test/context-durability.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  assertCompactGraphState,
  buildContextBudgetReport,
  pruneRawReviewPayloads,
} from "../context-durability.js";

describe("context durability", () => {
  it("reports serialized graph state size", () => {
    const report = buildContextBudgetReport({
      state: {
        schemaVersion: "KotikitGraphState/v1",
        runId: "run-1",
        flowId: "create-screen",
        flowVersion: "1.0.0",
        graphHash: "hash",
        status: "running",
        project: { root: "/tmp/project" },
        artifacts: [],
        errors: [],
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "ContextBudgetReport/v1",
      status: "passed",
      serializedBytes: expect.any(Number),
    });
  });

  it("blocks graph state above the hard budget", () => {
    expect(() =>
      assertCompactGraphState(
        {
          schemaVersion: "KotikitGraphState/v1",
          runId: "run-1",
          flowId: "create-screen",
          flowVersion: "1.0.0",
          graphHash: "hash",
          status: "running",
          project: { root: "/tmp/project" },
          review: { rawPayload: "x".repeat(2_000) },
          artifacts: [],
          errors: [],
        },
        { warningBytes: 512, maxBytes: 1024 }
      )
    ).toThrow(KotikitError);
  });

  it("prunes raw review snapshots after compact comment evidence exists", () => {
    expect(
      pruneRawReviewPayloads({
        commentSnapshot: { comments: [{ id: "comment-1", message: "Long raw payload" }] },
        commentEvidenceMap: { schemaVersion: "CommentEvidenceMap/v1" },
      })
    ).toEqual({
      commentEvidenceMap: { schemaVersion: "CommentEvidenceMap/v1" },
      commentSnapshotRef: "comment-evidence-map",
    });
  });
});
```

- [x] **Step 2: Write failing designer recovery tests**

Create `src/core/domain/test/designer-recovery.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createDesignerRecovery } from "../designer-recovery.js";

describe("designer recovery", () => {
  it("creates a plain-language recovery model", () => {
    expect(
      createDesignerRecovery({
        problem: "Kotikit cannot map 2 comments to exact layers.",
        why: "Guessing targets could apply revisions to the wrong part of the design.",
        recommendedAction: "Treat them as page-level feedback or open the comment map artifact.",
        actions: [
          { id: "page-feedback", label: "Use page-level feedback" },
          { id: "open-artifact", label: "Open comment map" },
        ],
        artifactRefs: ["run-1-comment-evidence-map"],
      })
    ).toEqual({
      schemaVersion: "DesignerRecovery/v1",
      problem: "Kotikit cannot map 2 comments to exact layers.",
      why: "Guessing targets could apply revisions to the wrong part of the design.",
      recommendedAction: "Treat them as page-level feedback or open the comment map artifact.",
      actions: [
        { id: "page-feedback", label: "Use page-level feedback" },
        { id: "open-artifact", label: "Open comment map" },
      ],
      artifactRefs: ["run-1-comment-evidence-map"],
    });
  });

  it("does not expose stack traces in recovery text", () => {
    const recovery = createDesignerRecovery({
      problem: "The local design-system cache is empty.",
      why: "Kotikit needs component evidence before composing a polished screen.",
      recommendedAction: "Run design-system sync or continue with draft components.",
      actions: [{ id: "sync-design-system", label: "Sync design system" }],
      technicalDetailsRef: "kotikit://runs/run-1",
    });

    expect(JSON.stringify(recovery)).not.toContain(" at ");
    expect(recovery.technicalDetailsRef).toBe("kotikit://runs/run-1");
  });
});
```

- [x] **Step 3: Run failing domain tests**

Run:

```bash
bun test src/core/domain/test/context-durability.test.ts src/core/domain/test/designer-recovery.test.ts
```

Expected: fail because the domain files do not exist.

- [x] **Step 4: Implement context durability helpers**

Create `src/core/domain/context-durability.ts`:

```ts
import { KotikitError } from "../../util/result.js";
import type { KotikitGraphState } from "../schemas/graph-state.js";

export type ContextBudgetReport = {
  schemaVersion: "ContextBudgetReport/v1";
  status: "passed" | "warning" | "blocked";
  serializedBytes: number;
  warningBytes: number;
  maxBytes: number;
  findings: string[];
};

export type ContextBudgetOptions = {
  warningBytes?: number;
  maxBytes?: number;
};

export const DEFAULT_CONTEXT_WARNING_BYTES = 128 * 1024;
export const DEFAULT_CONTEXT_MAX_BYTES = 256 * 1024;

export function buildContextBudgetReport(input: {
  state: KotikitGraphState;
  options?: ContextBudgetOptions;
}): ContextBudgetReport {
  const warningBytes = input.options?.warningBytes ?? DEFAULT_CONTEXT_WARNING_BYTES;
  const maxBytes = input.options?.maxBytes ?? DEFAULT_CONTEXT_MAX_BYTES;
  const serializedBytes = Buffer.byteLength(JSON.stringify(input.state), "utf8");
  const findings = [
    ...(serializedBytes > warningBytes
      ? [`Graph state is above warning budget: ${serializedBytes} bytes.`]
      : []),
    ...(serializedBytes > maxBytes
      ? [`Graph state is above hard budget: ${serializedBytes} bytes.`]
      : []),
  ];
  return {
    schemaVersion: "ContextBudgetReport/v1",
    status: serializedBytes > maxBytes ? "blocked" : serializedBytes > warningBytes ? "warning" : "passed",
    serializedBytes,
    warningBytes,
    maxBytes,
    findings,
  };
}

export function assertCompactGraphState(
  state: KotikitGraphState,
  options: ContextBudgetOptions = {}
): void {
  const report = buildContextBudgetReport({ state, options });
  if (report.status !== "blocked") return;
  throw new KotikitError(
    "This Kotikit run is carrying too much context to resume reliably.",
    "Persist raw Figma/comment data as artifacts and keep only compact contracts in graph state."
  );
}

export function pruneRawReviewPayloads(review: Record<string, unknown>): Record<string, unknown> {
  if (review.commentEvidenceMap === undefined) return review;
  const { commentSnapshot: _commentSnapshot, sourceSnapshot: _sourceSnapshot, ...rest } = review;
  return {
    ...rest,
    commentSnapshotRef: "comment-evidence-map",
  };
}
```

- [x] **Step 5: Implement designer recovery helper**

Create `src/core/domain/designer-recovery.ts`:

```ts
import { z } from "zod";

export const DesignerRecoverySchema = z.strictObject({
  schemaVersion: z.literal("DesignerRecovery/v1"),
  problem: z.string().min(1),
  why: z.string().min(1),
  recommendedAction: z.string().min(1),
  actions: z.array(
    z.strictObject({
      id: z.string().min(1),
      label: z.string().min(1),
    })
  ).min(1).max(3),
  artifactRefs: z.array(z.string().min(1)).optional(),
  technicalDetailsRef: z.string().min(1).optional(),
});

export type DesignerRecovery = z.infer<typeof DesignerRecoverySchema>;

export function createDesignerRecovery(
  input: Omit<DesignerRecovery, "schemaVersion">
): DesignerRecovery {
  return DesignerRecoverySchema.parse({
    schemaVersion: "DesignerRecovery/v1",
    ...input,
  });
}
```

- [x] **Step 6: Add runtime budget enforcement**

Modify `src/core/graph/runtime.ts`:

```ts
import { assertCompactGraphState } from "../domain/context-durability.js";
```

In `executeRun`, after `const patchedState = { ...run.state, ...output.statePatch };`, add:

```ts
assertCompactGraphState(patchedState);
```

In `startFlow`, after building the initial `state`, add:

```ts
assertCompactGraphState(state);
```

- [x] **Step 7: Prune raw comment payloads after mapping**

Modify `src/core/nodes/comments/index.ts`:

```ts
import { pruneRawReviewPayloads } from "../../domain/context-durability.js";
```

Change the `statePatch.review` value in `comments.buildEvidenceMap` from:

```ts
review: { ...review, commentEvidenceMap },
```

to:

```ts
review: pruneRawReviewPayloads({ ...review, commentEvidenceMap }),
```

- [x] **Step 8: Write failing graph resume tests**

Create `src/core/graph/test/context-durability.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGraphSmokeFixture, fakeDraftTarget, seedLocalDesignSystem } from "../../../../e2e/graph/fixtures/fake-figma.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kotikit-context-durability-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("context durability", () => {
  it("resumes create-screen from persisted state after a process-style runtime restart", async () => {
    seedLocalDesignSystem(root, { includePrimaryAction: false });
    const first = await createGraphSmokeFixture(root);
    const started = await first.runtime.startFlow({
      flowId: "create-screen",
      input: {
        project: { root, name: "Smoke Project" },
        userIntent: "Create Admin members page",
        figmaTarget: fakeDraftTarget("Draft - Members"),
      },
    });

    expect(started.status).toBe("waiting-for-user");

    const second = await createGraphSmokeFixture(root);
    const resumed = await second.runtime.answerRun({
      runId: started.runId,
      answer: "create-draft-components",
    });

    expect(resumed.runId).toBe(started.runId);
    expect(resumed.state.runId).toBe(started.runId);
    expect(JSON.stringify(resumed.state).length).toBeLessThan(256 * 1024);
  });
});
```

Keep this test on the existing smoke fixture for this slice. Do not add a new
fixture abstraction in this task.

- [x] **Step 9: Extend e2e resume coverage**

In `e2e/graph/create-screen-flow.test.ts`, add a test that:

1. starts `create-screen`;
2. answers until `waiting-for-figma`;
3. patches fake apply metadata;
4. recreates the runtime with `createGraphSmokeFixture(root)`;
5. calls `continueRun`;
6. expects `done`.

In `e2e/graph/review-comments-flow.test.ts`, add a test that:

1. starts `review-comments` from a seeded comment snapshot;
2. reaches the comment approval interrupt;
3. recreates the runtime with `createGraphSmokeFixture(root)`;
4. answers the approval;
5. expects the run to continue with the same `runId` and without raw
   `review.commentSnapshot` in state.

- [x] **Step 10: Run tests**

Run:

```bash
bun test src/core/domain/test/context-durability.test.ts src/core/domain/test/designer-recovery.test.ts src/core/graph/test/context-durability.test.ts e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: pass.

- [x] **Step 11: Commit**

```bash
git add src/core/domain/context-durability.ts src/core/domain/designer-recovery.ts src/core/domain/test/context-durability.test.ts src/core/domain/test/designer-recovery.test.ts src/core/graph/runtime.ts src/core/graph/test/context-durability.test.ts src/core/nodes/comments/index.ts e2e/graph/create-screen-flow.test.ts e2e/graph/review-comments-flow.test.ts
git commit -m "feat(graph): enforce context durability"
```

---

## Task 10: Update Designer-Facing Docs

**Files:**

- Modify: `README.md`
- Modify: `docs/workflows.md`
- Modify: `docs/figma.md`
- Modify: `docs/tools.md`
- Modify: `docs/troubleshooting.md`
- Modify: `KOTIKIT_MIGRATION.md`

- [x] **Step 1: Add docs text scan**

If a docs text-scan test exists, extend it. If not, create
`src/docs/test/ux-quality-docs.test.ts` with:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const docs = [
  "README.md",
  "docs/workflows.md",
  "docs/figma.md",
  "docs/tools.md",
  "docs/troubleshooting.md",
  "KOTIKIT_MIGRATION.md",
];

describe("UX quality docs", () => {
  it("does not recommend Chrome DevTools for comment review", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");
    expect(text.toLowerCase()).not.toContain("chrome devtools");
  });

  it("documents state matrices and draft lifecycle", () => {
    const text = docs.map((path) => readFileSync(path, "utf-8")).join("\n");
    expect(text).toContain("StateMatrix");
    expect(text).toContain("CommentEvidenceMap");
    expect(text).toContain("DraftComponentLifecycle");
    expect(text).toContain("context durability");
    expect(text).toContain("designer recovery");
  });
});
```

- [x] **Step 2: Run failing docs test**

Run:

```bash
bun test src/docs/test/ux-quality-docs.test.ts
```

Expected: fail until docs mention the new contracts.

- [x] **Step 3: Update docs**

Update docs with these designer-facing points:

- Kotikit plans screen states before visual composition.
- Loading, empty, no-results, error, and permission states are represented as
  page, region, component, or flow states.
- Data-table empty states replace the data region rather than becoming cards.
- Comment review uses Figma REST snapshots and a compact evidence map.
- Draft components are created only for gaps and must be used by generated
  screens.
- Designers only need to answer blocking questions; quick mode records
  assumptions.
- Kotikit can resume graph runs after assistant restarts, Figma apply waits,
  and approval interrupts.
- Blocking states explain the problem, why it matters, and the recommended next
  action in designer-friendly language.
- Raw Figma, comment, and research payloads are stored as artifacts after
  compact contracts are built, so normal tool output stays small.

Update `KOTIKIT_MIGRATION.md` with links to this spec and plan and a pending
implementation section named:

```md
## Planned Update: UX Quality Contracts
```

- [x] **Step 4: Run docs test**

Run:

```bash
bun test src/docs/test/ux-quality-docs.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/workflows.md docs/figma.md docs/tools.md docs/troubleshooting.md KOTIKIT_MIGRATION.md src/docs/test/ux-quality-docs.test.ts
git commit -m "docs: document ux quality contracts"
```

---

## Task 11: Stale Code Cleanup

**Files:**

- Inspect: `src/planning/design-comments.ts`
- Inspect: `src/planning/design-node-map.ts`
- Inspect: `src/planning/test/design-comments.test.ts`
- Inspect: `src/planning/test/design-node-map.test.ts`
- Modify or remove only files proven unused by graph-backed replacements.

- [x] **Step 1: Run Knip**

Run:

```bash
bun run check:unused
```

Expected: Knip may report unused exports or stale files. Save the relevant
findings in the task notes before editing.

- [x] **Step 2: Decide what is stale**

Keep code only if one of these is true:

- It is imported by graph nodes, MCP facade tools, or tests.
- It provides reusable pure behavior not yet moved into graph domain modules.
- It is part of local design-system sync/search.

Remove or migrate code if:

- It only supports removed public choreography.
- It duplicates `CommentEvidenceMap/v1`.
- It requires Chrome DevTools or manual browser inspection.
- It stores a node map that is not consumed by graph review or apply metadata.

- [x] **Step 3: Move reusable tests before deleting code**

If `src/planning/test/design-comments.test.ts` contains useful mapping cases,
move those cases into:

```text
src/core/domain/test/comment-evidence-map.test.ts
```

Run:

```bash
bun test src/core/domain/test/comment-evidence-map.test.ts
```

Expected: pass.

- [x] **Step 4: Remove stale files**

Use `git rm` only for files proven stale:

```bash
git rm src/planning/design-comments.ts src/planning/test/design-comments.test.ts
```

Do not remove `src/planning/design-node-map.ts` if it is still used to bridge
old apply metadata into the new comment evidence map. If it remains, add a
short module comment explaining that it is a compatibility source for graph
metadata.

- [x] **Step 5: Run focused tests**

Run:

```bash
bun test src/core/domain/test/comment-evidence-map.test.ts src/core/nodes/comments/test/comments-nodes.test.ts src/core/nodes/review/test/review-nodes.test.ts e2e/graph/review-comments-flow.test.ts
```

Expected: pass.

- [x] **Step 6: Run Knip again**

Run:

```bash
bun run check:unused
```

Expected: no stale files from this migration slice. Broader known cleanup
candidates may remain if unrelated.

Task note: after cleanup, Knip still reports broader exported-symbol and
exported-type hygiene outside this migration slice, but no longer reports the
removed `src/planning/design-comments.ts` or `src/planning/design-node-map.ts`
files.

- [ ] **Step 7: Commit**

```bash
git add src/core/domain/test/comment-evidence-map.test.ts src/planning
git commit -m "refactor(core): remove stale comment mapping code"
```

If no files are removed, commit only the explanatory compatibility comments:

```bash
git add src/planning/design-node-map.ts
git commit -m "docs(core): clarify node map compatibility boundary"
```

---

## Task 12: Full Verification And Review

**Files:**

- No planned code files. This task verifies the completed slice.

- [x] **Step 1: Run targeted graph tests**

Run:

```bash
bun test src/core/domain/test/ux-envelope.test.ts src/core/domain/test/state-representation.test.ts src/core/domain/test/draft-component-lifecycle.test.ts src/core/domain/test/comment-evidence-map.test.ts src/core/nodes/ux/test/ux-nodes.test.ts src/core/nodes/comments/test/comments-nodes.test.ts src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts src/core/nodes/draft-components/test/draft-component-nodes.test.ts src/core/nodes/figma/test/figma-nodes.test.ts src/core/nodes/qa/test/qa-nodes.test.ts src/core/nodes/review/test/review-nodes.test.ts
```

Expected: pass.

- [x] **Step 2: Run e2e graph tests**

Run:

```bash
bun test e2e/graph
```

Expected: pass.

- [x] **Step 3: Run full test suite**

Run:

```bash
bun test
```

Expected: pass.

- [x] **Step 4: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: pass.

- [x] **Step 5: Run local checks**

Run:

```bash
bun run check
```

Expected: pass.

- [x] **Step 6: Run unused check**

Run:

```bash
bun run check:unused
```

Expected: no unused files introduced by this migration slice. Any unrelated
repo-wide findings must be listed in the final handoff.

Task note: `bun run check:unused` still exits non-zero for broader repo-wide
exported-symbol and exported-type hygiene. It does not report migration-owned
stale files removed in Task 11.

- [ ] **Step 7: Manual demo in test repo**

In the demo repository, run a quick screen flow:

```text
Create Admin members page
```

Expected Figma result:

- same-size or clearly grouped screen states;
- loading is represented as skeleton rows or a table-region loading state;
- empty/no-results/error are region or page states, not cards;
- any draft table components are outside the main screen frame;
- every draft component is used as an instance or the run blocks;
- QA artifact reports pass.

Task note: not run in this shell session because it requires an active Figma
file/session. Offline graph smoke coverage for the same Admin members flow
passed through `bun test e2e/graph`.

- [x] **Step 8: Request code review**

Use `superpowers:requesting-code-review` for an independent review focused on:

- graph sequencing;
- checkpoint/resume behavior;
- graph-state budget enforcement;
- schema compatibility;
- non-hardcoded pattern-pack behavior;
- stale-code cleanup;
- designer-facing error messages;
- tests proving current screenshot regressions cannot return.

- [x] **Step 9: Fix review findings**

For each valid finding:

1. Write or update a failing test.
2. Implement the smallest fix.
3. Run the targeted test.
4. Commit with a Conventional Commit message.

Task note: independent review found no critical issues and raised compactness,
generic fallback, draft-overlap, and recovery-action findings. Fixes added
targeted tests for compact apply/comment state, generic unknown pattern packs,
draft component overlap blocking, compact comment metadata, and QA recovery
actions.

- [ ] **Step 10: Final migration doc update**

After implementation passes review, update `KOTIKIT_MIGRATION.md` from
`Planned Update` to:

```md
## Implementation Update: UX Quality Contracts
```

Include a concise summary of what shipped and the verification commands that
passed.

- [ ] **Step 11: Final commit if needed**

```bash
git add KOTIKIT_MIGRATION.md
git commit -m "docs: record ux quality contract migration"
```

---

## Plan Self-Review Checklist

- Spec coverage: comment evidence map, state matrix, draft lifecycle, context
  durability, designer recovery, docs, and stale cleanup each have
  implementation tasks.
- TDD coverage: every behavior task starts with a failing test.
- Generic architecture: pattern packs are data; node logic stays generic.
- Stale cleanup: cleanup happens only after graph replacements are tested.
- Non-technical designer UX: errors, recovery models, and docs use
  plain-language recovery.
- Atomic commits: every task ends with a scoped Conventional Commit.
