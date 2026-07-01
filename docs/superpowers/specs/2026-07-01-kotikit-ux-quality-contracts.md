# Kotikit UX Quality Contracts Spec

Date: 2026-07-01

## Purpose

This spec consolidates the three issues found during the first migrated
Kotikit Figma draft test:

1. Comment review needs a durable evidence map.
2. Loading, empty, and error output must be screen or region states, not cards.
3. Draft components need a lifecycle gate so unused or overlapping components
   fail before Kotikit claims success.

The goal is a lighter and more reliable Kotikit that still feels natural for
UX/UI designers. Designers should be able to ask for a quick high-fidelity
screen and get a polished result without learning graph state, Figma API
details, or debugging setup. Kotikit should infer safe defaults, ask only
blocking questions, and fail with plain-language guidance when required
evidence is missing.

## Sources And Research Findings

### Figma Comments

Figma comments are spatial review objects. The REST API exposes comments with
`client_meta`, file key, parent thread, author, creation time, resolved time,
order id, and reactions. The `client_meta` value carries positioning data,
including absolute canvas points, frame-relative offsets, and region dimensions.

Figma comment endpoints support reading comments, posting comments, replying to
root comments, deleting comments, and reading or writing reactions. Reading
comments requires the `file_comments:read` scope; posting comments requires
`file_comments:write`.

The Figma Plugin API can read and write file nodes, but it cannot access
comments, file permissions, location metadata, or version history. Figma says
those file-level aspects are available through the REST API.

Implication: Kotikit comment review should not depend on Chrome DevTools or
the Figma plugin API for comment access. The stable path is:

```text
Figma REST comment snapshot
  + graph apply metadata
  + current Figma node scan
  -> compact CommentEvidenceMap artifact
```

Primary sources:

- https://developers.figma.com/docs/rest-api/comments-types/
- https://developers.figma.com/docs/rest-api/comments-endpoints/
- https://developers.figma.com/docs/plugins/

### UX State Planning

NN/g guidance says UX research methods should be selected by design phase and
question type. It is not realistic to use every method for a project, but
combining methods is valuable. For Kotikit this means quick flows should use
curated pattern knowledge and recorded assumptions, while guided or deep flows
can ask more questions or run live research.

NN/g task analysis says designers must understand user goals, tasks, sequence,
hierarchy, frequency, and complexity before designing a product experience.
Kotikit therefore needs a small UX planning step before visual composition:
actor, goal, task, data, states, permissions, and edge cases.

Carbon's empty-state pattern says empty states belong in the otherwise empty
space, in context of the missing data. For tables, an empty state should
replace the table, column headers, and footer rather than appear as extra
content. This avoids users and assistive technology traversing irrelevant table
structure before learning that no data is available.

NN/g error-message guidance says errors should be visible, close to the source,
plain-language, specific, non-blaming, and constructive. Error states should
preserve user effort and offer a recovery action when one exists.

Implication: Kotikit should represent loading, empty, no-results, error, and
permission states as page, region, component, or flow states. It must not render
state previews as generic cards when the state is part of a data region.

Primary sources:

- https://www.nngroup.com/articles/which-ux-research-methods/
- https://www.nngroup.com/articles/task-analysis/
- https://carbondesignsystem.com/patterns/empty-states-pattern/
- https://www.nngroup.com/articles/error-message-guidelines/

### Figma Components And Layout Quality

Figma defines components as reusable elements. Instances are linked copies that
receive updates from the main component. Component properties expose intended
customization through booleans, instance swaps, editable text, variants, and
slots. Figma says this reduces documentation lookup, improves design-system
accuracy, and reduces individual layer overrides.

Figma auto layout lets frames respond to content changes through direction,
spacing, padding, alignment, and resizing. It is the default structure Kotikit
should use for generated UI, especially tables, lists, forms, cards, toolbars,
sidebars, and repeated rows.

Implication: Draft components are not decorative artifacts. If Kotikit creates
a draft component because a design-system component is missing, the screen must
use instances of that draft component. Unused draft components and overlapping
draft component areas are product failures.

Primary sources:

- https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma
- https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties
- https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma

## Product Principles

Kotikit should be dynamic without being unpredictable.

- Use curated, cited UX pattern packs for default quick flows.
- Use optional live research only for deep flows, unknown archetypes, or
  explicit designer requests.
- Ask designers only when the answer materially changes the design.
- Store assumptions in artifacts so designers can inspect why Kotikit chose a
  state set or component strategy.
- Keep the core generic. Built-in pattern packs are data, not hardcoded logic.
- Fail closed when Figma evidence, state representation, or draft component
  usage cannot be verified.

## Scope

### In Scope

- Add `UXEnvelope/v1` and `StateMatrix/v1` artifacts.
- Add `CommentEvidenceMap/v1` artifact.
- Add `DraftComponentLifecycle/v1` artifact.
- Add curated pattern-pack support for screen archetypes.
- Update the `create-screen` graph so UX state planning happens before
  composition.
- Update the `review-comments` graph so comment evidence mapping happens
  before grouping findings.
- Strengthen Figma apply metadata validation.
- Strengthen QA gates for state representation, orphan draft components,
  draft component overlap, and invalid component usage.
- Update docs and skills for designer-friendly behavior.
- Remove unused or stale code after equivalent graph-backed paths exist.

### Out Of Scope

- Restoring design-to-code.
- Building a full live web-research engine for every screen.
- Resolving Figma comments through REST, because the documented REST comments
  endpoints expose read, post, delete, and reactions, not a resolve operation.
- Publishing draft components to a shared team library.

## Designer Experience

### Quick Flow

Designer prompt:

```text
Create Admin members page
```

Expected Kotikit behavior:

1. Infer that this is likely an admin data-table screen.
2. Build a UX envelope with actor, task, data model, permissions, and edge
   cases.
3. Select the data-table pattern pack.
4. Create a state matrix with filled, loading, empty, no-results, error, and
   permission-limited states when relevant.
5. Search the local design-system cache.
6. Create draft components only for real gaps.
7. Compose same-size Figma frames or component variants for the selected states.
8. Record assumptions and QA results.

Kotikit should not ask questions if it can proceed safely. It should ask a
single blocking question only when there are multiple plausible product models,
for example:

```text
Should this members page be editable by workspace admins, or read-only for all
members?
```

If the designer does not answer and quick mode is allowed, Kotikit proceeds with
the safer default and records the assumption.

### Guided And Deep Flows

Guided flows can ask for actor, task priority, data size, permissions, and edge
states. Deep flows can optionally run live research or ask for design-system
documentation links. Both lanes use the same artifacts and gates as quick mode.

## Architecture

### New Artifact Contracts

#### UXEnvelope/v1

`UXEnvelope` is a compact, source-aware plan for the user experience behind the
requested screen or flow.

Required fields:

- `schemaVersion`
- `screenArchetype`
- `confidence`
- `actor`
- `primaryGoal`
- `primaryTask`
- `secondaryTasks`
- `dataModel`
- `permissions`
- `edgeCases`
- `assumptions`
- `sourceRefs`

`screenArchetype` is selected from an extensible set:

- `admin-data-table`
- `dashboard`
- `settings-form`
- `detail-page`
- `creation-flow`
- `review-workflow`
- `unknown`

The enum can grow through pattern packs and trusted flow-pack capabilities. The
runtime must not use string matching directly in node logic for final behavior;
string matching is allowed only inside the archetype classifier.

#### StateMatrix/v1

`StateMatrix` explains which states are required, where they appear, and how
they should be represented in Figma.

Each state entry includes:

- `id`
- `label`
- `kind`: `filled`, `loading`, `empty`, `no-results`, `error`, `permission`,
  `success`, or `custom`
- `scope`: `page`, `region`, `component`, or `flow`
- `affectedRegion`
- `persistentRegions`
- `replacementBehavior`
- `requiredComponents`
- `copy`
- `primaryAction`
- `secondaryAction`
- `sourceRefs`

Allowed replacement behaviors:

- `same-frame-variant`
- `replace-whole-page`
- `replace-region-content`
- `replace-table-body`
- `inline-feedback`
- `blocking-dialog`

For data tables, the default behavior is:

- Loading: keep page shell and table region, replace rows with skeleton rows.
- Empty: replace the table region when no data exists.
- No results: replace filtered results with clear-filter guidance.
- Error: keep page shell, show contextual recovery near the table region.
- Permission: show access explanation and request/access path if relevant.

#### CommentEvidenceMap/v1

`CommentEvidenceMap` normalizes Figma comments into durable review work items.

Each mapped comment includes:

- `commentId`
- `rootCommentId`
- `parentId`
- `orderId`
- `message`
- `author`
- `createdAt`
- `resolvedAt`
- `clientMeta`
- `mappedTarget`
- `mappingConfidence`
- `mappingStrategy`
- `threadSummary`
- `intent`
- `status`

Mapping strategies:

- `node-id`
- `parent-thread`
- `frame-offset`
- `region-overlap`
- `nearest-known-target`
- `unmapped`

Intent classification:

- `question`
- `bug-usability`
- `visual-polish`
- `copy-content`
- `design-system-mismatch`
- `implementation-handoff`
- `preference`
- `out-of-scope`
- `needs-human-clarification`

Kotikit must not invent an exact target for unmapped comments. Unmapped comments
remain explicit work items and can trigger a designer question.

#### DraftComponentLifecycle/v1

`DraftComponentLifecycle` proves draft components are created, placed safely,
and consumed by the generated screen.

Each draft component record includes:

- `draftComponentId`
- `name`
- `reason`
- `componentKey`
- `componentNodeId`
- `placement`
- `requiredInstances`
- `actualInstances`
- `status`
- `promotionNote`

Statuses:

- `planned`
- `created`
- `used`
- `unused-approved`
- `orphan-blocked`
- `overlap-blocked`

Rules:

- A draft component may be created only for a missing design-system component
  gap or an explicitly approved component creation.
- It must live in a reserved `Kotikit Draft Components` area or page.
- It must not overlap the main screen frames.
- It must be used as an instance in at least one generated state unless the
  designer explicitly approved keeping it unused.

### Pattern Packs

Pattern packs are JSON files validated by Zod. They make UX behavior extensible
without hardcoding screen-specific rules in TypeScript.

Each pack includes:

- `id`
- `version`
- `title`
- `appliesTo`
- `defaultStates`
- `stateRules`
- `componentRoles`
- `layoutRules`
- `qaRules`
- `sourceRefs`

Built-in packs for this slice:

- `admin-data-table`
- `settings-form`
- `dashboard-summary`

Only `admin-data-table` needs full behavior in the first implementation slice.
The other packs can exist as valid minimal packs so the architecture is generic.

### Graph Changes

#### create-screen

New graph shape:

```text
classify-intent
  -> capture-minimal-intent
  -> infer-screen-blueprint
  -> ux-classify-archetype
  -> ux-build-envelope
  -> ux-select-pattern-pack
  -> ux-plan-state-matrix
  -> ux-ask-blocking-questions
  -> summarize-brief-for-approval
  -> ask-brief-approval
  -> save-approved-brief
  -> search-local-design-system
  -> build-fit-report
  -> ask-missing-component-decision
  -> plan-missing-components
  -> ensure-draft-target
  -> create-draft-components
  -> validate-draft-components
  -> draft-components-build-lifecycle
  -> build-ui-composition-contract
  -> build-state-representation-contract
  -> build-layout-contract
  -> build-variable-binding-plan
  -> validate-no-hardcoded-imitation
  -> compile-high-fidelity-draft
  -> build-figma-apply-packet
  -> wait-for-apply-metadata
  -> record-apply-metadata
  -> verify-draft-invariants
  -> verify-state-representation
  -> verify-draft-component-lifecycle
  -> save-apply-report
  -> run-ui-quality-gate
  -> post-draft-qa
```

#### review-comments

New graph shape:

```text
fetch-comment-snapshot
  -> load-or-build-node-map
  -> build-comment-evidence-map
  -> classify-comment-intents
  -> group-findings
  -> create-revision-plan
  -> ask-reply-or-memory-approval
  -> save-review-session
  -> prepare-approved-comments
  -> detect-preference-candidate
  -> ask-memory-approval
  -> promote-preference
```

The flow must not require `figma.ensureDraftTarget` before evidence collection.
A draft target is required only before applying Figma revisions.

### Validation And QA

New fail-closed checks:

- `state-preview-card`: blocks `Loading`, `Empty`, or `Error` cards when the
  state matrix says the state is a page or region state.
- `missing-state-frame`: blocks when a required state has no matching Figma
  frame, variant, or region representation.
- `state-frame-size-mismatch`: blocks when same-frame variants have different
  dimensions.
- `state-shell-drift`: blocks when persistent regions such as sidebar, top bar,
  or page header differ across states without approval.
- `orphan-draft-component`: blocks when a created draft component has no actual
  instances in the generated screen states.
- `draft-component-overlap`: blocks when the draft component area overlaps main
  screen frames.
- `draft-component-detached-use`: blocks when the screen uses loose layers
  copied from a draft component instead of linked instances.
- `unmapped-comments`: blocks automated revision planning for those comments
  until Kotikit asks the designer or classifies them as non-actionable.

Existing checks remain:

- vertical text
- mirrored text
- flipped transforms
- negative dimensions
- clipped text
- missing component refs
- detached instances
- layout overlap
- hardcoded component imitation

## Data Flow

### Screen Creation

```text
User intent
  -> UXEnvelope
  -> PatternPack
  -> StateMatrix
  -> DesignSystemFitReport
  -> DraftComponentPlan
  -> DraftComponentLifecycle
  -> UICompositionContract
  -> StateRepresentationContract
  -> LayoutContract
  -> VariableBindingPlan
  -> DraftPlan
  -> FigmaApplyPacket
  -> FigmaApplyReport
  -> UIQualityGateReport
```

### Comment Review

```text
Figma REST comment snapshot
  -> Figma node/apply metadata map
  -> CommentEvidenceMap
  -> grouped findings
  -> revision plan
  -> explicit approval
  -> approved replies or revisions
  -> optional memory candidate
```

## Error Handling

All user-facing failures should use `KotikitError` with:

- a plain-language problem statement;
- a designer-friendly hint;
- no stack traces;
- no secret values;
- clear recovery action.

Examples:

```text
Kotikit could not place two comments on exact design elements.
Open the comment map artifact, or tell Kotikit whether to treat them as page-level feedback.
```

```text
The generated loading state was created as a preview card.
Use a table-region loading state with skeleton rows, or approve this as documentation-only output.
```

## Testing Strategy

Use Bun and TDD for every behavior change.

Required tests:

- artifact schema tests for all new contracts;
- pattern-pack validation tests;
- UX envelope and state matrix domain tests;
- create-screen graph tests proving state planning happens before composition;
- UI composition tests proving state preview cards fail;
- Figma metadata tests proving state frames and draft component instances are
  verified after apply;
- QA tests for orphan draft components, draft overlap, and state shell drift;
- comment evidence map tests for node-id mapping, parent-thread inheritance,
  region mapping, and unmapped comments;
- review-comments flow tests proving comments can be collected without a draft
  target and approval is still required before posting;
- docs text scans proving old Chrome DevTools comment guidance and state-card
  guidance do not reappear.

## Migration And Cleanup

Keep old planning utilities only while graph-backed replacements are not yet
complete. After `CommentEvidenceMap/v1` and graph comment tests pass:

- remove stale public wrappers that expose old comment map behavior;
- move reusable pure functions from `src/planning/design-comments.ts` into the
  graph comment domain module if still needed;
- remove stale tests that only validate removed public choreography;
- run `bun run check:unused`;
- delete only code that has equivalent graph-backed coverage.

## Acceptance Criteria

The migration slice is complete when:

- `create-screen` emits `UXEnvelope/v1`, `StateMatrix/v1`, and
  `DraftComponentLifecycle/v1` artifacts.
- The admin members page quick flow produces region-level table states, not
  state preview cards.
- Draft components created during the flow are used as component instances or
  the run blocks with an orphan draft component finding.
- `review-comments` builds `CommentEvidenceMap/v1` from REST snapshots and
  node/apply metadata without Chrome DevTools.
- Unmapped comments remain visible and do not get silently converted into
  guessed revisions.
- All new behavior is covered by focused Bun tests.
- Live docs explain the designer-facing behavior without requiring non-technical
  designers to debug graph internals.
- `bun test` and targeted graph/domain tests pass.
- `bun run check:unused` has been reviewed and stale code from this slice has
  been removed or explicitly retained because it is still referenced.
