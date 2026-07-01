# Kotikit Platform Flow Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Every implementation, review, or research agent working this plan must follow
> `docs/coding_guidelines.md` for the entire task: use Bun, work test-first for
> behavior changes, keep core modules agent-neutral, and make atomic
> Conventional Commits.

**Goal:** Rebuild kotikit into a LangGraph-backed, designer-first flow kit with a small MCP facade, Zod v4 schemas, local design-system search retained, and plugin-ready distribution.

**Architecture:** Introduce the graph runtime beside the existing tool surface, then replace each old public choreography flow with graph-backed facade calls. JSON flow manifests define choreography; Zod v4 TypeScript node definitions own schemas, behavior, side effects, capabilities, and safety. Local design-system sync/search remains the primary token-efficient grounding adapter, while Figma remote MCP is used for draft creation and optional validation.

**Tech Stack:** Bun, TypeScript strict mode, Zod v4, LangGraphJS, MCP TypeScript SDK, SQLite, existing kotikit sync/planning/Figma modules.

---

## Execution Model

Use the existing branch `feature/kotikit-migration`.

Implementation should be subagent-driven, but not all tasks can run at once.
Use this dependency order:

1. Tasks 1-4 are foundational and mostly sequential.
2. Tasks 5-7 can run in parallel after Task 4.
3. Tasks 8-10 can run in parallel after Tasks 5-7.
4. Tasks 11-13 are cleanup, docs, and packaging after graph-backed flows exist.

Recommended subagent split:

- Agent A: Zod v4 schemas, JSON Schema export, manifest validation.
- Agent B: graph runtime, node registry, run/artifact stores.
- Agent C: MCP facade tools/resources/prompts/completions.
- Agent D: create-screen flow, briefing subgraph, and old brainstorm/spec
  compatibility.
- Agent E: design-system grounding adapter and local search preservation.
- Agent F: UI quality contract, draft component preflight, variable binding,
  quick high-fidelity lane, and Figma apply metadata invariants.
- Agent G: improve-design/review-comments flows and memory approval
  invariants.
- Agent H: plugin wrappers and installer packaging.
- Agent I: stale-code removal and docs rewrite.

Every behavior-changing task must be test-first. Use Bun for all scripts and
tests. Make atomic Conventional Commits after each completed task.

## Target File Map

Create:

- `src/core/schemas/flow-definition.ts`
- `src/core/schemas/graph-state.ts`
- `src/core/schemas/artifact.ts`
- `src/core/schemas/json-schema-export.ts`
- `src/core/graph/node-registry.ts`
- `src/core/graph/compiler.ts`
- `src/core/graph/graph-hash.ts`
- `src/core/graph/runtime.ts`
- `src/core/graph/interrupts.ts`
- `src/core/runs/run-store.ts`
- `src/core/runs/artifact-store.ts`
- `src/core/runs/checkpoint-store.ts`
- `src/core/flows/built-in/first-run.flow.json`
- `src/core/flows/built-in/create-screen.flow.json`
- `src/core/flows/built-in/create-product-flow.flow.json`
- `src/core/flows/built-in/improve-existing-design.flow.json`
- `src/core/flows/built-in/review-comments.flow.json`
- `src/core/flows/built-in/sync-design-system.flow.json`
- `src/core/flows/built-in/resolve-missing-components.flow.json`
- `src/core/nodes/brief/index.ts`
- `src/core/nodes/flow/index.ts`
- `src/core/nodes/design-system/index.ts`
- `src/core/nodes/ui-composition/index.ts`
- `src/core/nodes/draft-components/index.ts`
- `src/core/nodes/draft/index.ts`
- `src/core/nodes/figma/index.ts`
- `src/core/nodes/qa/index.ts`
- `src/core/nodes/review/index.ts`
- `src/core/adapters/design-system/local-index.ts`
- `src/core/adapters/design-system/figma-remote-search.ts`
- `src/core/adapters/figma/target.ts`
- `src/core/adapters/figma/apply-packet.ts`
- `src/core/domain/ui-composition-contract.ts`
- `src/core/domain/layout-contract.ts`
- `src/core/domain/variable-binding-plan.ts`
- `src/core/domain/draft-component-plan.ts`
- `src/core/domain/ui-quality-gate.ts`
- `src/mcp/facade/tools.ts`
- `src/mcp/facade/resources.ts`
- `src/mcp/facade/prompts.ts`
- `src/mcp/facade/completions.ts`
- `schemas/kotikit-flow.schema.json`
- `schemas/kotikit-artifact.schema.json`
- `plugins/codex/.codex-plugin/plugin.json`
- `plugins/codex/skills/kotikit/SKILL.md`
- `plugins/claude/.claude-plugin/plugin.json`
- `plugins/claude/skills/kotikit/SKILL.md`

Modify:

- `package.json`
- `src/mcp/server.ts`
- `src/mcp/instructions.ts`
- `src/setup/scaffold-agents.ts`
- Existing MCP tool files that become wrappers.
- Existing tests under `src/**/test`.
- `README.md`
- `KOTIKIT_MIGRATION.md`
- `docs/architecture.md`
- `docs/tools.md`
- `docs/workflows.md`
- `docs/getting-started.md`
- `docs/figma.md`
- `docs/troubleshooting.md`
- `docs/development.md`
- `docs/modules/*`
- `.agents/skills/kotikit-auto/SKILL.md`
- `.agents/skills/kotikit-design-review/SKILL.md`

Remove near the end, after graph-backed replacements:

- `src/workflow/*`
- Public old workflow tool registration.
- Public old brainstorm/spec/flow/component-plan/design-plan/design-screen
  tools that no longer have a supported public role.

Do not remove:

- `src/sync/*` local design-system sync/search.
- `src/db/*` helpers still used by sync/review/runtime.
- `src/figma/*` safe target validation.
- `src/planning/*` until draft/review nodes fully wrap the behavior.
- The local plugin variable bridge unless a later explicit decision replaces
  it.

## Task 1: Upgrade Schema Foundation To Zod v4

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/core/schemas/flow-definition.ts`
- Create: `src/core/schemas/graph-state.ts`
- Create: `src/core/schemas/artifact.ts`
- Create: `src/core/schemas/json-schema-export.ts`
- Create: `src/core/schemas/test/json-schema-export.test.ts`
- Create: `schemas/kotikit-flow.schema.json`
- Create: `schemas/kotikit-artifact.schema.json`

- [ ] **Step 1: Write failing schema export tests**

Create `src/core/schemas/test/json-schema-export.test.ts` with tests that:

- import the flow definition and artifact schemas;
- call the Zod v4 JSON Schema export helper;
- assert exported schemas include stable `$id`, title, type, and required
  fields;
- assert artifact schemas include `ui-composition-contract`,
  `layout-contract`, `variable-binding-plan`, `draft-component-plan`, and
  `ui-quality-gate-report`;
- assert graph state schema includes optional UI composition, layout, variable
  binding, draft component, and UI quality gate fields;
- assert the exported flow schema rejects transforms/custom/date/map/set usage
  by scanning for an explicit allowlist of schema node types used by kotikit,
  because JSON Schema cannot represent those constructs cleanly.

Expected test names:

- `exports flow definition json schema with stable id`
- `exports artifact json schema with stable id`
- `rejects non json schema exported constructs`

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test src/core/schemas/test/json-schema-export.test.ts
```

Expected: fail because the files do not exist.

- [ ] **Step 3: Upgrade Zod**

Change `package.json` dependency:

```json
"zod": "^4.0.0"
```

Run:

```bash
bun install
```

Expected: `bun.lock` updates and existing imports still resolve.

- [ ] **Step 4: Add schema files**

Implement:

- `FlowDefinitionSchema`
- `FlowNodeSchema`
- `FlowEdgeSchema`
- `ArtifactSchema`
- `KotikitGraphStateSchema`
- `UICompositionContractSchema`
- `LayoutContractSchema`
- `VariableBindingPlanSchema`
- `DraftComponentPlanSchema`
- `UIQualityGateReportSchema`
- `exportKotikitJsonSchemas()`

Rules:

- no transforms in exported schemas;
- only JSON-representable schema constructs;
- all external schema files get stable `$id`;
- schemas use `strictObject` where object shape is owned by kotikit.

- [ ] **Step 5: Generate JSON Schema files**

Add a small Bun script or exported function that writes:

- `schemas/kotikit-flow.schema.json`
- `schemas/kotikit-artifact.schema.json`

Use deterministic formatting with two-space JSON indentation.

- [ ] **Step 6: Verify**

Run:

```bash
bun test src/core/schemas/test/json-schema-export.test.ts
bun test
bun run typecheck
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add package.json bun.lock src/core/schemas schemas
git commit -m "feat(core): add zod v4 graph schemas"
```

## Task 2: Add Node Registry And Flow Compiler

**Files:**

- Create: `src/core/graph/node-registry.ts`
- Create: `src/core/graph/compiler.ts`
- Create: `src/core/graph/graph-hash.ts`
- Create: `src/core/graph/test/node-registry.test.ts`
- Create: `src/core/graph/test/compiler.test.ts`
- Create: `src/core/graph/test/graph-hash.test.ts`
- Modify: `src/core/schemas/flow-definition.ts`

- [ ] **Step 1: Write failing registry tests**

Cover:

- duplicate node keys are rejected;
- unknown node key lookup returns a typed error;
- node definitions expose key, version, params schema, state reads/writes,
  side-effect class, required capabilities, and runner.

Run:

```bash
bun test src/core/graph/test/node-registry.test.ts
```

Expected: fail because registry does not exist.

- [ ] **Step 2: Implement node registry**

Implement:

- `NodeDefinition`
- `NodeRunner`
- `createNodeRegistry(definitions)`
- `registry.get(key)`
- `registry.list()`
- `registry.has(key)`

Use `KotikitError` for user-actionable validation failures.

- [ ] **Step 3: Write failing compiler tests**

Cover these invalid manifests:

- missing start node;
- duplicate node ids;
- edge references unknown source;
- edge references unknown target;
- unknown `uses` key;
- forbidden capability;
- unreachable node;
- terminal node not listed in `end`.

Cover one valid manifest that compiles into a graph descriptor without running
LangGraph yet.

- [ ] **Step 4: Implement compiler validation**

Implement:

- `validateFlowDefinition(definition, registry, policy)`
- `compileFlowDefinition(definition, registry, policy)`

The return type should include:

- validated manifest;
- resolved node definitions;
- graph hash input;
- capabilities;
- safety profile.

- [ ] **Step 5: Write and pass graph hash tests**

Hash must change when:

- manifest content changes;
- node version changes;
- state schema version changes;
- flow version changes.

Hash must remain stable when object key order changes.

- [ ] **Step 6: Verify**

Run:

```bash
bun test src/core/graph/test
bun run typecheck
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add src/core/graph src/core/schemas
git commit -m "feat(core): add flow compiler and node registry"
```

## Task 3: Add LangGraph Runtime And Local Run Stores

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/core/graph/runtime.ts`
- Create: `src/core/graph/interrupts.ts`
- Create: `src/core/runs/run-store.ts`
- Create: `src/core/runs/artifact-store.ts`
- Create: `src/core/runs/checkpoint-store.ts`
- Create: `src/core/graph/test/runtime.test.ts`
- Create: `src/core/runs/test/run-store.test.ts`
- Create: `src/core/runs/test/artifact-store.test.ts`

- [ ] **Step 1: Add failing runtime tests**

Create a fixture graph with three nodes:

- `fixture.start`
- `fixture.askUser`, which pauses with a pending question;
- `fixture.finish`, which writes an artifact.

Tests:

- `starts a flow and persists running state`
- `pauses on user interrupt`
- `resumes from answer`
- `writes artifact on completion`
- `rejects resume with mismatched graph hash`

- [ ] **Step 2: Install LangGraphJS**

Run:

```bash
bun add @langchain/langgraph
```

Pin the version written by Bun in `bun.lock`.

- [ ] **Step 3: Implement run and artifact stores**

Use local files or SQLite consistently with existing repo patterns. Prefer
SQLite if the graph runtime needs checkpoint queries; prefer JSON files only if
the implementation remains simpler and tests prove atomic writes.

Required APIs:

- `createRunStore(root)`
- `createArtifactStore(root)`
- `createCheckpointStore(root)`
- `createRun`
- `getRun`
- `updateRunState`
- `listRuns`
- `writeArtifact`
- `getArtifact`
- `listArtifacts`

- [ ] **Step 4: Implement runtime**

Required APIs:

- `createGraphRuntime({ registry, flowCatalog, runStore, artifactStore })`
- `startFlow({ flowId, input })`
- `continueRun({ runId })`
- `answerRun({ runId, answer })`
- `getRunState(runId)`
- `getArtifact(artifactId)`

Runtime must persist `flowId`, `flowVersion`, `manifestHash`, `graphHash`,
state schema version, and node versions before executing side effects.

- [x] **Step 5: Verify**

Run:

```bash
bun test src/core/graph/test/runtime.test.ts src/core/runs/test
bun run typecheck
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add package.json bun.lock src/core/graph src/core/runs
git commit -m "feat(core): add graph runtime and run stores"
```

## Task 4: Add Built-In Flow Catalog

**Files:**

- Create: `src/core/flows/catalog.ts`
- Create: `src/core/flows/built-in/first-run.flow.json`
- Create: `src/core/flows/built-in/create-screen.flow.json`
- Create: `src/core/flows/built-in/create-product-flow.flow.json`
- Create: `src/core/flows/built-in/improve-existing-design.flow.json`
- Create: `src/core/flows/built-in/review-comments.flow.json`
- Create: `src/core/flows/built-in/sync-design-system.flow.json`
- Create: `src/core/flows/built-in/resolve-missing-components.flow.json`
- Create: `src/core/flows/test/catalog.test.ts`
- Modify: `src/core/graph/compiler.ts`

- [ ] **Step 1: Write failing catalog tests**

Tests:

- built-in flow ids are unique;
- every built-in flow validates against `FlowDefinitionSchema`;
- every built-in flow compiles against a fixture registry;
- project flows are ignored unless config enables them;
- extension flows require allowlist entries with source, ref/version, hash, and
  capabilities.
- create-screen supports quick, guided, and deep lanes without separate public
  tool names;
- quick high-fidelity lane skips full brief approval when the user supplied
  enough intent and no safety-sensitive ambiguity exists.

- [ ] **Step 2: Add initial built-in flow manifests**

Add manifests for:

- `first-run`
- `create-screen`
- `create-product-flow`
- `improve-existing-design`
- `review-comments`
- `sync-design-system`
- `resolve-missing-components`

Do not expose `brief`, `design-system-grounding`, `draft`, or `review` as the
main built-in product menu. Implement those as reusable subgraphs or node
sequences inside the user-facing flows.

Use node keys from the design spec:

- `setup.runDoctor`
- `setup.detectFigmaRemoteMcp`
- `setup.detectLocalCache`
- `brief.classifyIntent`
- `brief.captureMinimalIntent`
- `brief.inferScreenBlueprint`
- `brief.askNextQuestion`
- `brief.recordAnswer`
- `brief.summarizeForApproval`
- `brief.saveApproved`
- `flow.captureGoalActorScenario`
- `flow.mapUserFlow`
- `flow.identifyScreensAndStates`
- `designSystem.searchLocal`
- `designSystem.buildFitReport`
- `designSystem.askMissingComponentDecision`
- `figma.ensureDraftTarget`
- `draft.compilePlan`
- `draft.compileHighFidelityDraft`
- `draft.buildFigmaApplyPacket`
- `ui.buildCompositionContract`
- `ui.buildLayoutContract`
- `ui.buildVariableBindingPlan`
- `ui.validateNoHardcodedImitation`
- `draftComponents.planMissing`
- `draftComponents.createOnDraftPage`
- `draftComponents.validateCreated`
- `figma.waitForApplyMetadata`
- `figma.verifyDraftInvariants`
- `qa.postDraftQa`
- `qa.runUiQualityGate`
- `review.collectEvidence`
- `review.compareToDesignSystem`
- `review.groupFindings`
- `review.createRevisionPlan`
- `review.askApproval`
- `review.applyApprovedRevisions`
- `memory.promotePreference`

- [ ] **Step 3: Implement flow catalog loader**

Required APIs:

- `loadBuiltInFlows()`
- `loadProjectFlows(root, config)`
- `loadExtensionFlows(root, config)`
- `loadFlowCatalog(root, config)`

Project and extension loading must fail closed.

- [ ] **Step 4: Verify**

Run:

```bash
bun test src/core/flows/test/catalog.test.ts
bun run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/flows src/core/graph
git commit -m "feat(core): add built-in flow catalog"
```

## Task 5: Add MCP Facade Tools, Resources, And Prompts

**Files:**

- Create: `src/mcp/facade/tools.ts`
- Create: `src/mcp/facade/resources.ts`
- Create: `src/mcp/facade/prompts.ts`
- Create: `src/mcp/facade/completions.ts`
- Create: `src/mcp/facade/test/tools.test.ts`
- Create: `src/mcp/facade/test/resources.test.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/instructions.ts`

- [ ] **Step 1: Write failing facade tests**

Tests:

- server lists small facade tools;
- `kotikit_flow_list` returns built-in flows without full manifest bodies;
- `kotikit_start` starts a fixture flow;
- `kotikit_answer` resumes a paused run;
- `kotikit_get_artifact` returns one artifact;
- resource listing exposes run and artifact URI templates;
- prompt listing exposes designer-facing prompts.

- [ ] **Step 2: Implement facade tool registration**

Register:

- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_start`
- `kotikit_continue`
- `kotikit_answer`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`
- `kotikit_search_design_system`
- `kotikit_record_figma_apply`
- `kotikit_review_figma_target`
- `kotikit_doctor`

Keep outputs compact and secret-safe.

- [ ] **Step 3: Add MCP resources and prompts**

Expose resources:

- `kotikit://runs/{runId}`
- `kotikit://runs/{runId}/state`
- `kotikit://artifacts/{artifactId}`
- `kotikit://flows/{flowId}`

Expose prompts:

- `kotikit.first_run`
- `kotikit.quick_screen_draft`
- `kotikit.create_screen`
- `kotikit.create_product_flow`
- `kotikit.improve_existing_design`
- `kotikit.review_comments`
- `kotikit.create_brief`
- `kotikit.create_figma_draft`
- `kotikit.review_figma_design`
- `kotikit.sync_design_system`

If the current MCP SDK support is incomplete, implement the supported parts
first and document the missing SDK feature in `docs/development.md`.

- [ ] **Step 4: Update server wiring**

In `src/mcp/server.ts`, register facade tools before old compatibility tools.
Keep old tools available during the transition.

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/mcp/facade/test src/mcp/test/server.test.ts
bun run typecheck
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add src/mcp/facade src/mcp/server.ts src/mcp/instructions.ts docs/development.md
git commit -m "feat(mcp): add graph facade surface"
```

## Task 6: Implement Create-Screen And Briefing Nodes

**Files:**

- Create: `src/core/nodes/brief/index.ts`
- Create: `src/core/nodes/flow/index.ts`
- Create: `src/core/nodes/brief/test/brief-nodes.test.ts`
- Create: `src/core/nodes/flow/test/flow-nodes.test.ts`
- Modify: `src/spec/brainstorm-session.ts`
- Modify: `src/spec/schema.ts`
- Modify: `src/mcp/tools/brainstorm.ts`
- Modify: `src/mcp/tools/spec.ts`

- [ ] **Step 1: Write failing brief node tests**

Tests:

- classify a rough idea into screen or multi-screen flow intent;
- capture minimal intent for quick high-fidelity screen creation;
- infer a screen blueprint from a short request and local design-system hints;
- ask one missing question at a time;
- record an answer into graph state;
- produce an approval summary;
- save an approved `design-brief` artifact;
- map a multi-screen product flow from actor, goal, and scenario;
- identify screens and states from the product-flow map.
- produce screen blueprints that list required UI parts, repeated patterns,
  screen states, and table/list/form regions for later UI composition checks.

- [ ] **Step 2: Implement brief nodes**

Implement node definitions:

- `brief.classifyIntent`
- `brief.captureMinimalIntent`
- `brief.inferScreenBlueprint`
- `brief.askNextQuestion`
- `brief.recordAnswer`
- `brief.summarizeForApproval`
- `brief.saveApproved`
- `flow.captureGoalActorScenario`
- `flow.mapUserFlow`
- `flow.identifyScreensAndStates`

Reuse existing spec/brainstorm domain logic where it is clean. Move pure
helpers under `src/core/domain/brief.ts`, `src/core/domain/screen-model.ts`,
or `src/core/domain/flow-model.ts` only when it reduces duplication.

- [ ] **Step 3: Add compatibility wrappers**

Make old brainstorm/spec tools call the graph facade where practical:

- `kotikit_brainstorm_start` starts the guided lane of `create-screen`;
- `kotikit_brainstorm_answer` answers the active create-screen run;
- `kotikit_brainstorm_confirm` approves the summary;
- `kotikit_spec_create` reads the saved brief artifact.

Mark old tools as deprecated in descriptions.

- [ ] **Step 4: Verify**

Run:

```bash
bun test src/core/nodes/brief/test src/core/nodes/flow/test src/spec/test src/mcp/tools/brainstorm.test.ts src/mcp/tools/spec.test.ts
bun run typecheck
```

If existing tool tests have different filenames, run the relevant `bun test`
targets under `src/mcp`.

- [ ] **Step 5: Commit**

```bash
git add src/core/nodes/brief src/core/nodes/flow src/spec src/mcp/tools/brainstorm.ts src/mcp/tools/spec.ts
git commit -m "feat(core): add adaptive screen and flow briefing nodes"
```

## Task 7: Preserve Local Design-System Search As Primary Adapter

**Files:**

- Create: `src/core/adapters/design-system/local-index.ts`
- Create: `src/core/adapters/design-system/figma-remote-search.ts`
- Create: `src/core/nodes/design-system/index.ts`
- Create: `src/core/nodes/design-system/test/design-system-nodes.test.ts`
- Modify: `src/mcp/tools/ds-search.ts`
- Modify: `src/mcp/tools/icons-search.ts`
- Modify: `src/sync/*` only where adapter boundaries require exported helpers.

- [x] **Step 1: Write failing adapter tests**

Tests:

- local component search returns compact refs only;
- local icon search omits SVG payloads unless explicitly requested;
- fit report prefers local cache results;
- remote Figma search is not called when local cache has enough matches;
- missing local cache returns a friendly setup action;
- component fit report identifies exact matches, substitutes, missing
  components, variable/style gaps, and repeated patterns such as tables,
  lists, forms, tabs, filters, and toolbars.

- [x] **Step 2: Implement local adapter**

Wrap existing SQLite-backed search in:

- `searchLocalComponents(query, options)`
- `getLocalComponent(ref)`
- `searchLocalIcons(query, options)`
- `getLocalVariables(options)`
- `buildLocalDesignSystemContext(root)`

Keep result payloads compact.

- [x] **Step 3: Implement remote adapter interface**

Add an interface for Figma remote MCP search but keep it injectable. The first
implementation can be a typed boundary that returns `not-configured` unless a
client adapter is supplied by the MCP facade.

- [x] **Step 4: Implement design-system nodes**

Implement:

- `designSystem.searchLocal`
- `designSystem.searchRemoteOptional`
- `designSystem.buildFitReport`
- `designSystem.askMissingComponentDecision`
- `designSystem.saveFitReport`

Fit reports must not silently approve hardcoded substitutes. If a meaningful UI
part has no matching component, the report must mark it as a component gap for
the draft-component preflight.

- [x] **Step 5: Verify**

Run:

```bash
bun test src/core/adapters/design-system src/core/nodes/design-system src/sync/test src/mcp/tools/ds-search.test.ts
bun run typecheck
```

- [x] **Step 6: Commit**

```bash
git add src/core/adapters/design-system src/core/nodes/design-system src/mcp/tools/ds-search.ts src/mcp/tools/icons-search.ts src/sync
git commit -m "feat(core): preserve local design-system grounding adapter"
```

## Task 8: Implement UI Contract, Draft Component, Draft, And QA Nodes

**Files:**

- Create: `src/core/adapters/figma/target.ts`
- Create: `src/core/adapters/figma/apply-packet.ts`
- Create: `src/core/domain/ui-composition-contract.ts`
- Create: `src/core/domain/layout-contract.ts`
- Create: `src/core/domain/variable-binding-plan.ts`
- Create: `src/core/domain/draft-component-plan.ts`
- Create: `src/core/domain/ui-quality-gate.ts`
- Create: `src/core/nodes/ui-composition/index.ts`
- Create: `src/core/nodes/draft-components/index.ts`
- Create: `src/core/nodes/draft/index.ts`
- Create: `src/core/nodes/figma/index.ts`
- Create: `src/core/nodes/qa/index.ts`
- Create: `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`
- Create: `src/core/nodes/draft-components/test/draft-component-nodes.test.ts`
- Create: `src/core/nodes/draft/test/draft-nodes.test.ts`
- Create: `src/core/nodes/figma/test/figma-nodes.test.ts`
- Create: `src/core/nodes/qa/test/qa-nodes.test.ts`
- Modify: `src/figma/draft-target.ts`
- Modify: `src/planning/design-planner.ts`
- Modify: `src/planning/design-plan-store.ts`
- Modify: `src/mcp/tools/figma-target.ts`
- Modify: `src/mcp/tools/plan-design.ts`
- Modify: `src/mcp/tools/design-screen.ts`
- Modify: `src/mcp/tools/design-apply.ts`

- [x] **Step 1: Write failing UI contract and draft invariant tests**

Tests:

- guided/deep draft path refuses to build apply packet without approved brief;
- quick high-fidelity path can build from a screen blueprint and assumptions
  artifact without blocking on full brief approval;
- UI composition contract rejects meaningful UI parts without an existing
  component key, created draft component key, or approved primitive exception;
- UI composition contract rejects partial component imitation where repeated
  rows/cards/cells mix instances with loose hardcoded layers;
- missing component preflight creates draft components in a
  `Kotikit Draft Components` section before screen composition starts;
- table/list contract requires a table/list component family or draft
  components for table container, header row, data row, cell, and needed
  states;
- layout contract rejects generated structural frames without auto layout or
  grid layout;
- variable binding plan rejects color, typography, radius, spacing, stroke,
  shadow, or effect literals without an approved fallback;
- draft creation refuses Figma write without safe draft page target;
- apply metadata must match file, page, and kotikit Section;
- literal variable fallback pauses for approval;
- missing component strategy pauses for approval;
- post-draft QA saves findings without posting comments or changing memory;
- UI quality gate rejects vertical text, mirrored text, flipped transforms,
  negative dimensions, clipped words, missing component refs, detached
  instances, layout overlap, and hardcoded component imitations.

- [x] **Step 2: Wrap target validation**

Move or wrap existing target logic behind:

- `ensureDraftTarget(state, input)`
- `validateDraftTargetUrl(url)`
- `bindDraftTarget(scope, screen, pageUrl)`

No Figma write can happen without this state.

- [x] **Step 3: Wrap design planning**

Expose UI and draft planning as graph nodes:

- `ui.buildCompositionContract`
- `ui.buildLayoutContract`
- `ui.buildVariableBindingPlan`
- `ui.validateNoHardcodedImitation`
- `draftComponents.planMissing`
- `draftComponents.createOnDraftPage`
- `draftComponents.validateCreated`
- `draft.compilePlan`
- `draft.compileHighFidelityDraft`
- `draft.draftScreensIncrementally`
- `draft.buildFigmaApplyPacket`
- `qa.runUiQualityGate`
- `qa.postDraftQa`

The apply packet remains compatible with official Figma MCP writes. The packet
must carry enough metadata to verify component keys, draft component origins,
variable/style bindings, auto-layout settings, repeated-item structure, and
text transforms after apply.

- [x] **Step 4: Implement apply recording nodes**

Implement:

- `figma.waitForApplyMetadata`
- `figma.recordApplyMetadata`
- `figma.verifyDraftInvariants`
- `figma.saveApplyReport`

- [x] **Step 5: Add compatibility wrappers**

Old target/plan/design/apply tools should delegate to the active draft graph
run or read graph artifacts.

Mark old public descriptions as deprecated.

Task 8 implementation note: graph draft nodes now persist apply-packet
artifacts and `kotikit_design_get_screen` reads those graph artifacts before
falling back to legacy design plans. The small MCP facade is wired to the graph
runtime in `buildServer`, including Figma target binding and apply metadata
patching. Full removal of the remaining legacy target, plan, and apply
compatibility tools belongs to the later facade and stale-code cleanup tasks.

- [x] **Step 6: Verify**

Run:

```bash
bun test src/core/nodes/ui-composition src/core/nodes/draft-components src/core/nodes/draft src/core/nodes/figma src/core/nodes/qa src/figma/test src/planning/test src/mcp/tools
bun run typecheck
```

- [x] **Step 7: Commit**

```bash
git add src/core/adapters/figma src/core/domain src/core/nodes/ui-composition src/core/nodes/draft-components src/core/nodes/draft src/core/nodes/figma src/core/nodes/qa src/figma src/planning src/mcp/tools
git commit -m "feat(core): add ui contract draft creation nodes"
```

## Task 9: Implement Improve-Design, Review-Comments, And Memory Nodes

**Files:**

- Create: `src/core/nodes/review/index.ts`
- Create: `src/core/nodes/review/test/review-nodes.test.ts`
- Create: `src/core/nodes/memory/index.ts`
- Create: `src/core/nodes/memory/test/memory-nodes.test.ts`
- Create: `src/mcp/tools/review-artifacts.ts`
- Modify: `src/core/graph/runtime.ts`
- Modify: `src/core/flows/built-in/improve-existing-design.flow.json`
- Modify: `src/core/flows/built-in/review-comments.flow.json`
- Modify: `src/core/nodes/built-in-registry.ts`
- Modify: `src/mcp/facade/tools.ts`
- Modify: `src/mcp/tools/design-comments.ts`
- Modify: `src/mcp/tools/design-review.ts`
- Modify: `KOTIKIT_MIGRATION.md`
- Modify: `docs/tools.md`

- [x] **Step 1: Write failing review tests**

Tests:

- improve-existing-design flow gathers bounded evidence;
- improve-existing-design flow compares an exact Figma target to local
  design-system evidence;
- improve-existing-design revision plan preserves component instances and
  variable bindings instead of replacing them with hardcoded layers;
- findings are grouped by theme/severity;
- revision plan is saved as an artifact;
- approved revisions can be applied through the safe Figma draft/update path;
- UI quality gate runs after approved revisions;
- comment posting pauses for explicit approval;
- memory promotion pauses for explicit approval.

- [x] **Step 2: Implement review nodes**

Implement:

- `review.collectEvidence`
- `review.compareToDesignSystem`
- `review.groupFindings`
- `review.createRevisionPlan`
- `review.askApproval`
- `review.applyApprovedRevisions`
- `review.saveSession`

- [x] **Step 3: Implement memory nodes**

Implement:

- `memory.detectPreferenceCandidate`
- `memory.askPromotionApproval`
- `memory.promotePreference`

Memory promotion must write to the existing local design-review database or a
clearly versioned successor store.

- [x] **Step 4: Add compatibility wrappers**

Old comment/review tools should delegate to the review graph where possible or
read graph artifacts.

Task 9 implementation note: `improve-existing-design` now gathers bounded
review evidence, compares it to the local design-system index while preserving
seeded design-system context, saves a revision-plan artifact, pauses for
approval, records approved revision apply metadata, then runs the UI quality
gate. `review-comments` now gathers comment evidence from a seeded comment
snapshot, skips revision-apply approval, pauses before comment posting, saves
the review session, prepares approved comments in the existing review DB,
detects a DB-backed memory candidate, pauses before memory promotion, and
promotes only after explicit approval. Legacy comment/review report tools read
matching graph review artifacts before falling back to existing design-review
SQLite reports, while legacy fetch/start tools include graph-facade hints with
seed input for `kotikit_start` and exclude resolved comments from graph seeds
unless `includeResolved` is requested.

- [x] **Step 5: Verify**

Run:

```bash
bun test src/core/nodes/review src/core/nodes/memory src/planning/test/design-comments.test.ts src/planning/test/design-review.test.ts src/db/test/design-review-db.test.ts src/mcp/facade/test/tools.test.ts src/mcp/tools/test/design-review.test.ts src/mcp/tools/test/design-comments.test.ts
bun run typecheck
```

- [x] **Step 6: Commit**

```bash
git add KOTIKIT_MIGRATION.md docs/superpowers/plans/2026-06-30-kotikit-platform-flow-kit.md docs/tools.md src/core/graph/runtime.ts src/core/flows/built-in/improve-existing-design.flow.json src/core/flows/built-in/review-comments.flow.json src/core/nodes/built-in-registry.ts src/core/nodes/review src/core/nodes/memory src/core/nodes/test/built-in-node-registry.test.ts src/mcp/facade/tools.ts src/mcp/facade/test/tools.test.ts src/mcp/tools/design-comments.ts src/mcp/tools/design-review.ts src/mcp/tools/review-artifacts.ts src/mcp/tools/test/design-comments.test.ts src/mcp/tools/test/design-review.test.ts
git commit -m "feat(core): move design review into graph flow"
```

## Task 10: Add Flow-Pack Trust And Project Flow Enablement

**Files:**

- Modify: `src/config/schema.ts`
- Modify: `src/config/init.ts`
- Modify: `src/core/flows/catalog.ts`
- Modify: `src/core/graph/compiler.ts`
- Create: `src/core/flows/test/trust-policy.test.ts`
- Modify: `docs/modules/config.md`

- [x] **Step 1: Write failing trust policy tests**

Tests:

- project flow is ignored when project flows are disabled;
- enabled project flow must declare allowed capabilities;
- extension flow without allowlist is rejected;
- extension flow hash mismatch is rejected;
- active run persists graph hash and manifest hash.

- [x] **Step 2: Extend config schema**

Add:

```ts
flowPacks: {
  projectFlowsEnabled: boolean;
  allowedProjectCapabilities: string[];
  extensions: {
    id: string;
    source: string;
    versionOrRef: string;
    hash: string;
    capabilities: string[];
    enabled: boolean;
  }[];
}
```

Default:

- project flows disabled;
- no extension packs enabled.

- [x] **Step 3: Enforce trust policy in compiler/catalog**

Project and extension flows must fail closed before execution.

Task 10 implementation note: `flowPacks` is now part of config defaults.
Project-local flows stay disabled by default and must remain inside
`flowPacks.allowedProjectCapabilities` when enabled. Extension flows must have
an enabled allowlist entry with `source`, `versionOrRef`, `hash`, and explicit
capabilities, and are rejected on hash or capability drift. Runtime tests assert
custom flows cannot omit registry-declared node capabilities, trusted active
runs persist `manifestHash` and `graphHash`, and real MCP sessions use the
config-backed flow catalog instead of built-ins only.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/core/flows/test/trust-policy.test.ts src/config/test
bun run typecheck
```

- [x] **Step 5: Commit**

```bash
git add src/config src/core/flows src/core/graph docs/modules/config.md
git commit -m "feat(core): add flow pack trust policy"
```

## Task 11: Add Codex And Claude Plugin Wrappers

**Files:**

- Create: `plugins/codex/kotikit/.codex-plugin/plugin.json`
- Create: `plugins/codex/kotikit/skills/kotikit/SKILL.md`
- Create: `plugins/claude/kotikit/.claude-plugin/plugin.json`
- Create: `plugins/claude/kotikit/skills/kotikit/SKILL.md`
- Create: `plugins/README.md`
- Create: `src/setup/test/plugin-manifests.test.ts`
- Modify: `src/setup/scaffold-agents.ts`
- Modify: `docs/getting-started.md`

- [x] **Step 1: Write failing plugin manifest tests**

Tests:

- Codex plugin manifest exists and references the shared MCP server;
- Claude plugin manifest exists and references the shared MCP server;
- plugin skills contain designer-facing launch instructions;
- manifests do not hardcode user-specific absolute paths;
- source installer remains available for local development.

- [x] **Step 2: Add Codex plugin wrapper**

Add Codex plugin manifest with:

- name `kotikit`;
- version from package or manually synced package version;
- bundled skill;
- MCP server config that launches shared `kotikit-mcp`.

- [x] **Step 3: Add Claude plugin wrapper**

Add Claude plugin manifest with:

- name `kotikit`;
- version matching package;
- bundled skill;
- MCP server config that launches shared `kotikit-mcp`.

- [x] **Step 4: Keep scaffold as compatibility installer**

Update scaffold docs and notes:

- plugins are preferred when available;
- scaffold remains useful for repo development and manual MCP setup;
- default setup no longer positions PAT as required for draft creation.

Task 11 implementation note: `plugins/codex/kotikit` and
`plugins/claude/kotikit` now package thin assistant wrappers around the shared
`kotikit-mcp` command. Each wrapper contains a plugin manifest, `.mcp.json`, and
designer-facing `kotikit` skill. The installable root folder matches the
manifest name, and plugin setup assumes `kotikit-mcp` is available on `PATH`
through an installed or linked kotikit package. The source scaffold remains
available for local development and manual MCP setup, and setup docs now
position Figma PATs as local sync and design/comment review credentials rather
than a requirement for draft creation through Figma remote MCP auth.

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/setup/test/plugin-manifests.test.ts src/setup/test/scaffold-agents.test.ts
bun run typecheck
```

- [x] **Step 6: Commit**

```bash
git add plugins src/setup docs/getting-started.md
git commit -m "feat(setup): add codex and claude plugin wrappers"
```

## Task 12: Deprecate And Remove Stale Public Tool Choreography

**Files:**

- Modify: `src/mcp/server.ts`
- Modify/Delete: old files under `src/mcp/tools`
- Delete: `src/workflow/*`
- Delete: `src/workflow/test/*`
- Modify: `docs/tools.md`
- Modify: `docs/modules/workflow.md`
- Modify: `docs/modules/mcp.md`
- Modify: `scripts/measure-tokens.ts`

- [x] **Step 1: Write failing stale-surface tests**

Tests:

- public MCP tool list contains the small facade;
- public MCP tool list does not contain removed old choreography tools;
- compatibility aliases still present, if any, are explicitly marked
  deprecated;
- token measurement script no longer measures deleted tools.

- [x] **Step 2: Remove manual workflow router**

Delete `src/workflow/*` only after all graph-backed flow tests pass.

- [x] **Step 3: Remove or internalize old tool files**

Remove public registration for:

- old workflow tools;
- old brainstorm/spec/flow tools after brief graph wrappers are removed;
- old component-plan public tool;
- old plan-design/design-screen/design-apply public tools after draft graph
  exposes artifacts;
- old review/comment public sprawl after review graph facade works.

Keep internal domain engines if graph nodes still call them.

- [x] **Step 4: Verify no stale imports**

Run:

```bash
rg "src/workflow|kotikit_workflow_|kotikit_brainstorm_|kotikit_spec_|kotikit_flow_create|kotikit_component_plan_create|kotikit_plan_design|kotikit_design_get_screen" src docs README.md KOTIKIT_MIGRATION.md
```

Expected: only migration-history references and explicit deprecation notes
remain.

- [x] **Step 5: Run unused-code check**

Run:

```bash
bun run check:unused
```

Expected: inspect report and remove unused graph-migration leftovers that are
part of this slice. Do not remove unrelated pre-existing unused exports without
separate approval.

- [x] **Step 6: Verify**

Run:

```bash
bun test
bun run typecheck
bun run check
bun run measure
```

Expected: pass.

Task 12 implementation note: the public MCP surface now exposes only the graph
facade and support tools. The manual `src/workflow/*` router, old public
workflow/brainstorm/spec/flow/component-plan/design-plan/design-screen/design
apply/review/comment/memory handlers, stale tests, and unused migration
leftovers were removed. Live docs, scaffolded skills, MCP instructions, and
token measurement now point at graph runs and artifacts. `kotikit_review_figma_target`
collects bounded REST-backed Figma evidence before starting
`improve-existing-design`; the graph can review evidence before a safe draft
target is bound and pauses for target binding before approved revisions are
applied. `bun run check:unused` still reports unrelated exported-symbol/type
hygiene, but no Task 12 stale files remain in the unused-file report.

- [ ] **Step 7: Commit**

```bash
git add src docs README.md KOTIKIT_MIGRATION.md scripts
git commit -m "refactor(mcp): remove stale workflow tool choreography"
```

Task 12 commit note: committed as `009f1ac feat(mcp): remove stale public
choreography tools`.

## Task 13: Rewrite User And Developer Docs

**Files:**

- Modify: `README.md`
- Modify: `KOTIKIT_MIGRATION.md`
- Modify: `docs/architecture.md`
- Modify: `docs/tools.md`
- Modify: `docs/workflows.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/figma.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/development.md`
- Modify: `docs/modules/config.md`
- Modify: `docs/modules/mcp.md`
- Modify: `docs/modules/planning.md`
- Modify: `docs/modules/spec.md`
- Modify: `docs/modules/sync.md`
- Modify: `docs/modules/workflow.md`
- Modify: `.agents/skills/kotikit-auto/SKILL.md`
- Modify: `.agents/skills/kotikit-design-review/SKILL.md`

- [x] **Step 1: Write doc scan tests**

Add or update a documentation scan test that checks:

- design-to-code is not described as core;
- setup docs say plugins are preferred and scaffold is compatibility;
- PAT is advanced for local sync/search, not required for draft happy path;
- local design-system cache remains documented as primary token-efficient
  grounding;
- old tool names are absent from live user docs except migration/deprecation
  notes.

- [x] **Step 2: Rewrite README**

README should describe:

- designer-first flow kit;
- built-in flows;
- quick high-fidelity screen creation from existing design-system components;
- local design-system cache retained;
- Figma remote MCP happy path;
- plugin installation direction;
- current alpha status;
- design-to-code removed.

- [x] **Step 3: Rewrite getting started**

Structure:

1. Install kotikit plugin or use local scaffold for development.
2. Connect Figma remote MCP for draft creation.
3. Optional PAT setup for local design-system sync/search and comments.
4. Run quick screen draft or guided create-screen flow.
5. Run product-flow, improve-design, or review-comments flow as needed.
6. Run sync-design-system only when local cache needs setup or refresh.

- [x] **Step 4: Rewrite architecture and tools docs**

Architecture should center graph runtime and adapters.

Tools doc should list the small facade and move old tool names to a migration
history section only if still needed.

- [x] **Step 5: Rewrite skills**

Skills should instruct agents to use the facade:

- list or start flows;
- answer graph interrupts;
- fetch artifacts;
- search local design-system cache;
- use official Figma MCP for writes;
- record apply metadata.

- [x] **Step 6: Verify docs**

Run:

```bash
bun test src/test/tooling-config.test.ts
bun run check
rg "design-to-code|codegen|scaffold React|kotikit_workflow_|kotikit_plan_design|kotikit_design_get_screen" README.md docs .agents
```

Expected: only approved migration-history or explicit non-core references.

Task 13 implementation note: added a live documentation regression test for
removed choreography tools, plugin/scaffold guidance, Figma PAT scoping, local
design-system grounding, and design-to-code removal. README, architecture,
workflow, plugin, migration, and already-updated live docs now describe graph
runs, artifacts, built-in designer flows, official Figma apply, and local
design-system search.

- [x] **Step 7: Commit**

```bash
git add README.md KOTIKIT_MIGRATION.md docs .agents
git commit -m "docs: document platform flow kit architecture"
```

## Task 14: Add End-To-End Graph Smoke Tests

**Files:**

- Create: `e2e/graph/create-screen-flow.test.ts`
- Create: `e2e/graph/create-product-flow.test.ts`
- Create: `e2e/graph/improve-existing-design-flow.test.ts`
- Create: `e2e/graph/review-comments-flow.test.ts`
- Create: `e2e/graph/fixtures/fake-figma.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing e2e tests**

Tests:

- create-screen quick lane starts from a short high-fidelity request, searches
  the local design-system fixture, resolves missing components, creates draft
  components when needed, builds UI composition/layout/variable contracts,
  creates an apply packet, waits for fake apply metadata, runs UI quality
  gates, and saves post-draft QA;
- create-screen guided lane asks, answers, approves, saves a brief artifact,
  then creates the draft artifact chain;
- create-product-flow maps fake actor/goal/scenario input into screens and
  drafts them incrementally;
- improve-existing-design gathers fake target evidence, builds a revision plan,
  preserves component/variable bindings, and pauses before applying revisions;
- review-comments gathers fake comments, builds a revision plan, and pauses
  before posting comments or memory promotion.

- [ ] **Step 2: Add fake Figma adapter**

Fake adapter must not call network. It should return deterministic node ids,
page ids, Section ids, comments, and apply metadata.

- [ ] **Step 3: Add script**

Add package script:

```json
"test:e2e:graph": "bun test e2e/graph"
```

- [ ] **Step 4: Verify**

Run:

```bash
bun run test:e2e:graph
bun test
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add e2e package.json
git commit -m "test: add graph flow smoke coverage"
```

## Task 15: Final Cleanup And Release Readiness Check

**Files:**

- Modify as needed based on verification output.

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun run typecheck
bun run check
bun run measure
bun run check:unused
git diff --check
```

Expected:

- `bun test` passes;
- typecheck passes;
- check passes;
- measure passes and updates token docs if payloads changed;
- `check:unused` has either no migration-owned issues or documented
  unrelated pre-existing findings;
- `git diff --check` passes.

- [ ] **Step 2: Inspect public MCP surface**

Run a focused registry inspection test or command that prints public tool names.

Expected public guided workflow tools:

- `kotikit_flow_list`
- `kotikit_flow_validate`
- `kotikit_start`
- `kotikit_continue`
- `kotikit_answer`
- `kotikit_get_artifact`
- `kotikit_list_artifacts`
- `kotikit_search_design_system`
- `kotikit_record_figma_apply`
- `kotikit_review_figma_target`
- `kotikit_doctor`

- [ ] **Step 3: Inspect docs for stale user paths**

Run:

```bash
rg "clone.*kotikit|bun run scaffold:agents|FIGMA_TOKEN=.*required|kotikit_workflow_|kotikit_brainstorm_|kotikit_plan_design|kotikit_design_get_screen" README.md docs .agents plugins
```

Expected:

- local scaffold appears only as compatibility/development setup;
- `FIGMA_TOKEN` appears only as advanced PAT setup for local sync/search or
  REST-backed comments/review;
- old tool names appear only in migration/deprecation history.

- [ ] **Step 4: Final commit if needed**

```bash
git add .
git commit -m "chore: finalize platform flow kit migration"
```

Use this commit only for small verification-driven cleanup. Do not bundle large
behavior changes that were not reviewed.

## Acceptance Criteria

The migration is complete when:

- Zod v4 is the schema source of truth.
- JSON Schema files are generated for external flow/artifact contracts.
- LangGraph runtime can start, pause, resume, and complete flows.
- Built-in first-run, create-screen, create-product-flow,
  improve-existing-design, review-comments, sync-design-system, and
  resolve-missing-components flows exist.
- Create-screen supports a quick high-fidelity lane that uses existing
  design-system components and asks only safety-critical blocking questions.
- Briefing, design-system grounding, draft creation, QA, review, and memory
  are reusable internal subgraphs instead of the primary user-facing menu.
- High-fidelity draft creation requires UI composition, layout, variable
  binding, draft component, and UI quality gate artifacts.
- Meaningful UI parts are existing component instances, kotikit-created draft
  component instances, or approved primitives; hardcoded component imitation is
  rejected.
- Missing components are created and validated in the active draft page before
  screen or flow composition starts.
- Generated structural UI uses auto layout or grid layout, with manual
  positioning limited to top-level placement and approved exceptions.
- Colors, typography, spacing, radius, stroke, shadow, and effects use synced
  variables/styles unless a fallback is explicitly approved.
- UI quality gates block completion on vertical or mirrored text, flipped
  transforms, clipped words, detached instances, missing component refs,
  hardcoded imitations, overlap, or mismatched Figma target metadata.
- Local design-system search remains the primary grounding adapter.
- Figma remote MCP is used as the default draft creation write path.
- PAT setup is not required for draft creation happy path.
- PAT setup remains documented for local sync/search and REST-backed
  design/comment review.
- Small MCP facade is the main public guided workflow surface.
- Old tool choreography is removed or explicitly deprecated as wrappers.
- Codex and Claude plugin wrappers exist and use the shared MCP server.
- Project/extension flow packs are fail-closed with explicit allowlists and
  hash/version pins.
- Docs and skills describe designer flows, not internal tool chains.
- Full verification passes with Bun.

## Open Research Items For Later

These are intentionally outside the first implementation wave:

- Whether Figma remote MCP can populate the local SQLite cache cheaply enough
  to remove PAT-backed sync for most users.
- Whether MCPB bundles with compiled Bun binaries are reliable after signing,
  notarization, Windows smoke tests, and antivirus checks.
- Whether public extension flow packs need signed metadata in addition to hash
  pins.
- Whether a visual local setup wizard is worth building after plugin
  installation works.
