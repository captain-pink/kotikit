# Kotikit Blueprint-First Intent And Refine Existing Spec

Date: 2026-07-03

## Purpose

Kotikit's `create-screen` flow must preserve the designer's real product
intent from detailed PRDs instead of collapsing requests into brittle keyword
templates. It must also support a normal path for changing existing Figma work,
including pages that contain multiple screens or frames.

This work fixes a current failure mode where incidental words in a detailed
request can hijack the title, classification, UX archetype, UI parts, repeated
patterns, variable bindings, and canvas placement. The solution must stay
generic. Kotikit core should not try to guess every screen type a UX/UI
designer might request.

## Problem

The current `create-screen` path treats rich plain-language input as something
the core can classify with substring rules:

- words such as `onboarding` can force a title such as `Onboarding Flow`;
- broad words such as `admin`, `members`, or `table` can force table-specific
  UI parts such as pagination, row avatars, status badges, and row action
  menus;
- UX pattern packs can be selected from broad keywords instead of explicit
  evidence;
- detailed PRDs can become generic table/list/form plans;
- variable bindings can repeat the same token kind across every part without
  role-specific reasoning;
- canvas planning assumes a new section of full-screen frames instead of
  replacing or refining an exact existing frame.

This is not a missing flow invocation. It is a boundary problem: rich product
reasoning is happening in hardcoded core heuristics.

## Product Principles

- Blueprint-first: assistants read rich PRDs and provide structured intent;
  kotikit validates and preserves that structure.
- Generic core: core logic accepts typed contracts and local evidence. It does
  not encode product-specific or keyword-specific screen mappings.
- Low-confidence beats wrong: detailed unstructured intent without a blueprint
  should ask one useful clarification or continue with generic, non-hijacked
  parts.
- Pattern packs are optional aids, not classifiers. A built-in archetype or
  pattern pack may shape defaults only when explicitly supplied by a blueprint
  or when a short fallback prompt is unambiguous.
- Existing work is first-class. Refining a selected frame, selected frames, or
  a page is a different workflow from drafting a new screen.
- Tests and examples use only mocked product, company, customer, and user data.

## Screen Archetypes

The current `UXEnvelope` schema exposes a fixed `screenArchetype` enum:

```text
admin-data-table, dashboard, settings-form, detail-page, creation-flow,
review-workflow, unknown
```

The enum itself is not the whole problem. The failure happens when kotikit uses
incidental text to choose one of those values and then lets the chosen archetype
drive pattern packs, state matrices, parts, and layout. For example, a request
that mentions an admin area, a dashboard, or an onboarding domain in passing
should not become an admin table, dashboard summary, or onboarding flow.

The fix is to change the meaning of archetypes:

- `screenArchetype` is an optional blueprint field or a low-confidence fallback
  result, not a required classifier.
- Unknown, custom, or unmapped experiences stay valid. They should not be
  forced into the closest built-in enum.
- Built-in pattern packs are selected only from explicit blueprint intent or
  from short, simple fallback prompts such as "create members table".
- Rich PRDs without a blueprint default to `unknown` with low confidence and a
  clarification, not to the nearest enum.
- Do not add more built-in enum values to chase product combinations. If schema
  compatibility requires the current enum in the first implementation slice,
  bespoke screens should map to `unknown` while their custom archetype or
  product pattern stays preserved in blueprint metadata.
- Longer term, version the schema so it can allow custom archetype ids or
  pattern-pack ids from validated local/project data instead of only a closed
  built-in enum.

## Proposed Contracts

### Start Input

`kotikit_start` and `RuntimeStartInput` should accept structured blueprint
fields in addition to the existing inputs:

```ts
type RuntimeStartInput = {
  project: ProjectRef;
  userIntent?: string;
  screenBlueprint?: ScreenBlueprintInput;
  flowBlueprint?: FlowBlueprintInput;
  canvasIntent?: CanvasIntentInput;
  figmaTarget?: unknown;
  figmaDefaults?: unknown;
  designSystem?: unknown;
  feedback?: unknown;
};
```

Only one of `screenBlueprint` or `flowBlueprint` should be primary. If both are
provided, `screenBlueprint` must identify which screen in the flow is the
initial draft target, or kotikit should ask for clarification.

### Screen Blueprint

The screen blueprint is the assistant-authored source of truth for one screen:

```ts
type ScreenBlueprintInput = {
  schemaVersion: "ScreenBlueprintInput/v1";
  title: string;
  productDomain?: string;
  description?: string;
  primaryGoal?: string;
  primaryActor?: string;
  confidence?: "explicit" | "inferred" | "low";
  archetype?: {
    id: string;
    source: "blueprint" | "local-pattern-pack" | "unknown";
    confidence: "explicit" | "inferred" | "low";
  };
  requiredUiParts: BlueprintUiPart[];
  repeatedPatterns?: BlueprintRepeatedPattern[];
  regions?: BlueprintRegion[];
  states?: BlueprintState[];
  designSystemHints?: string[];
};
```

`title` is preserved exactly after validation. Invalid titles receive a friendly
error rather than being replaced with a keyword-derived title.

### Flow Blueprint

The flow blueprint preserves multi-screen structure even when `create-screen`
only drafts the primary screen in the first implementation slice:

```ts
type FlowBlueprintInput = {
  schemaVersion: "FlowBlueprintInput/v1";
  title: string;
  productDomain?: string;
  description?: string;
  confidence?: "explicit" | "inferred" | "low";
  screens: Array<ScreenBlueprintInput & { id: string }>;
  entryScreenId?: string;
  primaryScreenId?: string;
  transitions?: Array<{
    fromScreenId: string;
    toScreenId: string;
    trigger: string;
  }>;
};
```

`create-screen` should store the full flow blueprint in `flowModel`, then draft
the `primaryScreenId` or ask one clarification if the primary screen is
ambiguous.

### UI Parts And Roles

Blueprint UI parts must carry semantic intent instead of relying on names:

```ts
type BlueprintUiPart = {
  id: string;
  name: string;
  role: string;
  regionId?: string;
  priority?: "primary" | "secondary" | "supporting";
  componentIntent?: string;
  variableRoles?: Array<{
    property: "fill" | "text" | "effect" | "spacing" | "radius" | "stroke" | "shadow";
    semanticRole: string;
    optional?: boolean;
  }>;
};
```

Composition should preserve `role`, `regionId`, and `variableRoles`. Variable
binding should use those semantic roles when present. It should not blindly bind
every property to every part.

### Canvas Intent

Canvas intent separates "new work" from "existing work":

```ts
type CanvasIntentInput =
  | {
      mode: "create-new-section";
      sectionName?: string;
    }
  | {
      mode: "replace-existing-frame";
      targetFrame: CanvasTargetFrameInput;
    }
  | {
      mode: "refine-existing-targets";
      scope: "selected-frame" | "selected-frames" | "page";
      targets: CanvasTargetFrameInput[];
    };

type CanvasTargetFrameInput = {
  nodeId: string;
  name?: string;
  role?: string;
  screenId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
};
```

`replace-existing-frame` must keep the target frame's identity and intended
bounds. It should not create a new arbitrary section by default.

## Flow Design

### create-screen

`create-screen` remains the new-screen/new-flow drafting path:

1. Accept and validate `screenBlueprint`, `flowBlueprint`, and `canvasIntent`.
2. Preserve full `flowBlueprint` in state when provided.
3. Select the primary screen for the first draft.
4. Derive `brief` and `screen` state from the blueprint without rewriting title,
   domain, required parts, repeated patterns, regions, or states.
5. Use fallback heuristics only for short, simple requests.
6. For detailed unstructured PRDs without a blueprint, mark confidence low and
   ask one clarification or produce a generic shell with no hijacked parts.
7. If `canvasIntent.mode` is `replace-existing-frame`, build a canvas plan for
   the exact target frame instead of a new section.

### refine-existing

Add a separate `refine-existing` flow for changes to existing Figma work:

1. Require explicit Figma target context: selected frame, selected frames, or
   page-level targets.
2. Accept `screenBlueprint` or `flowBlueprint` plus `canvasIntent` with
   `refine-existing-targets`.
3. Map blueprint screens to targets by explicit `screenId` or target role first.
4. Ask one clarification when multiple targets could match a requested screen.
5. Produce a refinement/revision plan that modifies target frames in place.
6. Reuse the same UX, design-system, composition, variable, apply, evidence, and
   QA gates where those contracts still apply.

The new flow should not be a workaround for broken intent parsing. It exists
because existing-frame refinement is a distinct designer workflow.

## Fallback Heuristics

Fallback is intentionally small:

- It applies only when no blueprint is provided.
- It applies only to short prompts with clear explicit structure.
- "Create members table" can infer a members table.
- "Create settings form" can infer a settings form.
- Broad terms such as `admin`, `dashboard`, `members`, `onboarding`, `profile`,
  or `table` inside a detailed PRD are not enough by themselves.
- There are no special-case title mappings such as `Onboarding Flow`.

The fallback should return low confidence for detailed requests that lack a
blueprint instead of guessing.

## Validation And Errors

Blueprint validation should happen at the MCP/runtime boundary with Zod:

- reject empty titles, duplicate ids, missing primary screen references, and
  target-frame modes without targets;
- preserve unknown but valid role/archetype strings instead of rejecting custom
  product intent;
- keep error messages designer-friendly through existing `KotikitError`
  patterns;
- keep raw PRD text compact in graph state and move structured summaries into
  artifacts where appropriate.

## Testing

Use TDD with Bun. Focused regression tests should cover:

- a detailed PRD that mentions a mocked onboarding domain must not become
  `Onboarding Flow`;
- a mocked Events experience request preserves title `Events Experience`;
- admin dashboard wording alone does not infer data table, pagination, row
  avatar, or row action menu;
- explicit members table request still infers members-table parts;
- blueprint input overrides fallback;
- detailed intent without blueprint asks a clarification or produces generic,
  non-hijacked parts;
- blueprint archetype `unknown` does not select a built-in pattern pack;
- explicit blueprint archetype can select a pattern pack without substring
  classification;
- `replace-existing-frame` canvas intent uses the target frame instead of a new
  section placement;
- `refine-existing` accepts multiple targets and asks a clarification when a
  screen-to-target mapping is ambiguous;
- variable bindings use semantic part roles when provided and avoid repeated
  universal bindings across every part.

All test data must use mocked product, company, customer, and user names.

## Migration Plan

1. Add blueprint and canvas-intent schemas near the graph state/runtime boundary.
2. Extend `RuntimeStartInput`, `KotikitGraphState`, and `kotikit_start` input
   schema to accept the new fields.
3. Replace the regex/substr parser work in `brief/index.ts` with
   blueprint-preserving helpers and tiny fallback classification.
4. Update UX envelope building so archetype comes from blueprint evidence or
   short fallback only.
5. Preserve part roles into `UICompositionContract`.
6. Update variable binding to respect part-level `variableRoles`.
7. Extend canvas planning for `replace-existing-frame`.
8. Add the `refine-existing` built-in flow as a thin composition of existing
   graph nodes plus target-mapping/refinement nodes.
9. Update docs and kotikit agent skill guidance so assistants produce
   blueprints before calling `kotikit_start` for detailed PRDs.

## Open Implementation Notes

- The first implementation slice should fix `create-screen` and preserve
  flow-blueprint structure while drafting one primary screen.
- The second slice should add `refine-existing` and multi-target mapping.
- A later cleanup can relax or version the closed `screenArchetype` enum into a
  custom/project-pattern-friendly schema once the blueprint path is covered.
- The implementation must not add new built-in archetype enum values for the
  reported product cases. That would repeat the same hardcoded-template failure
  in a larger list.
- Existing pattern packs can remain useful as data, but no core node should use
  broad substring matching to force them for detailed PRDs.
