# Kotikit Platform Flow Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- Agent D: brief flow and old brainstorm/spec compatibility.
- Agent E: design-system grounding adapter and local search preservation.
- Agent F: draft flow and Figma apply metadata invariants.
- Agent G: review flow and memory approval invariants.
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
- `src/core/flows/built-in/brief.flow.json`
- `src/core/flows/built-in/design-system-grounding.flow.json`
- `src/core/flows/built-in/draft.flow.json`
- `src/core/flows/built-in/review.flow.json`
- `src/core/nodes/brief/index.ts`
- `src/core/nodes/design-system/index.ts`
- `src/core/nodes/draft/index.ts`
- `src/core/nodes/figma/index.ts`
- `src/core/nodes/review/index.ts`
- `src/core/adapters/design-system/local-index.ts`
- `src/core/adapters/design-system/figma-remote-search.ts`
- `src/core/adapters/figma/target.ts`
- `src/core/adapters/figma/apply-packet.ts`
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

- [ ] **Step 7: Commit**

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

- [ ] **Step 7: Commit**

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

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/core/graph/test/runtime.test.ts src/core/runs/test
bun run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/core/graph src/core/runs
git commit -m "feat(core): add graph runtime and run stores"
```

## Task 4: Add Built-In Flow Catalog

**Files:**

- Create: `src/core/flows/catalog.ts`
- Create: `src/core/flows/built-in/brief.flow.json`
- Create: `src/core/flows/built-in/design-system-grounding.flow.json`
- Create: `src/core/flows/built-in/draft.flow.json`
- Create: `src/core/flows/built-in/review.flow.json`
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

- [ ] **Step 2: Add initial built-in flow manifests**

Add manifests for:

- `brief`
- `design-system-grounding`
- `draft`
- `review`

Use node keys from the design spec:

- `brief.classifyIntent`
- `brief.askNextQuestion`
- `brief.recordAnswer`
- `brief.summarizeForApproval`
- `brief.saveApproved`
- `designSystem.searchLocal`
- `designSystem.buildFitReport`
- `designSystem.askMissingComponentDecision`
- `figma.ensureDraftTarget`
- `draft.compilePlan`
- `draft.buildFigmaApplyPacket`
- `figma.waitForApplyMetadata`
- `figma.verifyDraftInvariants`
- `review.collectEvidence`
- `review.groupFindings`
- `review.createRevisionPlan`
- `review.askApproval`
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

- [ ] **Step 6: Commit**

```bash
git add src/mcp/facade src/mcp/server.ts src/mcp/instructions.ts docs/development.md
git commit -m "feat(mcp): add graph facade surface"
```

## Task 6: Implement Brief Flow Nodes

**Files:**

- Create: `src/core/nodes/brief/index.ts`
- Create: `src/core/nodes/brief/test/brief-nodes.test.ts`
- Modify: `src/spec/brainstorm-session.ts`
- Modify: `src/spec/schema.ts`
- Modify: `src/mcp/tools/brainstorm.ts`
- Modify: `src/mcp/tools/spec.ts`

- [ ] **Step 1: Write failing brief node tests**

Tests:

- classify a rough idea into screen or multi-screen flow intent;
- ask one missing question at a time;
- record an answer into graph state;
- produce an approval summary;
- save an approved `design-brief` artifact.

- [ ] **Step 2: Implement brief nodes**

Implement node definitions:

- `brief.classifyIntent`
- `brief.askNextQuestion`
- `brief.recordAnswer`
- `brief.summarizeForApproval`
- `brief.saveApproved`

Reuse existing spec/brainstorm domain logic where it is clean. Move pure
helpers under `src/core/domain/brief.ts` only when it reduces duplication.

- [ ] **Step 3: Add compatibility wrappers**

Make old brainstorm/spec tools call the graph facade where practical:

- `kotikit_brainstorm_start` starts `brief`;
- `kotikit_brainstorm_answer` answers the active brief run;
- `kotikit_brainstorm_confirm` approves the summary;
- `kotikit_spec_create` reads the saved brief artifact.

Mark old tools as deprecated in descriptions.

- [ ] **Step 4: Verify**

Run:

```bash
bun test src/core/nodes/brief/test src/spec/test src/mcp/tools/brainstorm.test.ts src/mcp/tools/spec.test.ts
bun run typecheck
```

If existing tool tests have different filenames, run the relevant `bun test`
targets under `src/mcp`.

- [ ] **Step 5: Commit**

```bash
git add src/core/nodes/brief src/spec src/mcp/tools/brainstorm.ts src/mcp/tools/spec.ts
git commit -m "feat(core): move briefing into graph flow"
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

- [ ] **Step 1: Write failing adapter tests**

Tests:

- local component search returns compact refs only;
- local icon search omits SVG payloads unless explicitly requested;
- fit report prefers local cache results;
- remote Figma search is not called when local cache has enough matches;
- missing local cache returns a friendly setup action.

- [ ] **Step 2: Implement local adapter**

Wrap existing SQLite-backed search in:

- `searchLocalComponents(query, options)`
- `getLocalComponent(ref)`
- `searchLocalIcons(query, options)`
- `getLocalVariables(options)`
- `buildLocalDesignSystemContext(root)`

Keep result payloads compact.

- [ ] **Step 3: Implement remote adapter interface**

Add an interface for Figma remote MCP search but keep it injectable. The first
implementation can be a typed boundary that returns `not-configured` unless a
client adapter is supplied by the MCP facade.

- [ ] **Step 4: Implement design-system nodes**

Implement:

- `designSystem.searchLocal`
- `designSystem.searchRemoteOptional`
- `designSystem.buildFitReport`
- `designSystem.askMissingComponentDecision`
- `designSystem.saveFitReport`

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/core/adapters/design-system src/core/nodes/design-system src/sync/test src/mcp/tools/ds-search.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/core/adapters/design-system src/core/nodes/design-system src/mcp/tools/ds-search.ts src/mcp/tools/icons-search.ts src/sync
git commit -m "feat(core): preserve local design-system grounding adapter"
```

## Task 8: Implement Draft Flow Nodes

**Files:**

- Create: `src/core/adapters/figma/target.ts`
- Create: `src/core/adapters/figma/apply-packet.ts`
- Create: `src/core/nodes/draft/index.ts`
- Create: `src/core/nodes/figma/index.ts`
- Create: `src/core/nodes/draft/test/draft-nodes.test.ts`
- Create: `src/core/nodes/figma/test/figma-nodes.test.ts`
- Modify: `src/figma/draft-target.ts`
- Modify: `src/planning/design-planner.ts`
- Modify: `src/planning/design-plan-store.ts`
- Modify: `src/mcp/tools/figma-target.ts`
- Modify: `src/mcp/tools/plan-design.ts`
- Modify: `src/mcp/tools/design-screen.ts`
- Modify: `src/mcp/tools/design-apply.ts`

- [ ] **Step 1: Write failing draft invariant tests**

Tests:

- draft flow refuses to build apply packet without approved brief;
- draft flow refuses Figma write without safe draft page target;
- apply metadata must match file, page, and kotikit Section;
- literal variable fallback pauses for approval;
- missing component strategy pauses for approval.

- [ ] **Step 2: Wrap target validation**

Move or wrap existing target logic behind:

- `ensureDraftTarget(state, input)`
- `validateDraftTargetUrl(url)`
- `bindDraftTarget(scope, screen, pageUrl)`

No Figma write can happen without this state.

- [ ] **Step 3: Wrap design planning**

Expose draft planning as a graph node:

- `draft.compilePlan`
- `draft.buildFigmaApplyPacket`

The apply packet remains compatible with official Figma MCP writes.

- [ ] **Step 4: Implement apply recording nodes**

Implement:

- `figma.waitForApplyMetadata`
- `figma.recordApplyMetadata`
- `figma.verifyDraftInvariants`
- `figma.saveApplyReport`

- [ ] **Step 5: Add compatibility wrappers**

Old target/plan/design/apply tools should delegate to the active draft graph
run or read graph artifacts.

Mark old public descriptions as deprecated.

- [ ] **Step 6: Verify**

Run:

```bash
bun test src/core/nodes/draft src/core/nodes/figma src/figma/test src/planning/test src/mcp/tools
bun run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/core/adapters/figma src/core/nodes/draft src/core/nodes/figma src/figma src/planning src/mcp/tools
git commit -m "feat(core): move draft creation into graph flow"
```

## Task 9: Implement Review And Memory Flow Nodes

**Files:**

- Create: `src/core/nodes/review/index.ts`
- Create: `src/core/nodes/review/test/review-nodes.test.ts`
- Create: `src/core/nodes/memory/index.ts`
- Create: `src/core/nodes/memory/test/memory-nodes.test.ts`
- Modify: `src/planning/design-comments.ts`
- Modify: `src/planning/design-review.ts`
- Modify: `src/db/design-review-db.ts`
- Modify: `src/mcp/tools/design-comments.ts`
- Modify: `src/mcp/tools/design-review.ts`

- [ ] **Step 1: Write failing review tests**

Tests:

- review flow gathers bounded evidence;
- findings are grouped by theme/severity;
- revision plan is saved as an artifact;
- comment posting pauses for explicit approval;
- memory promotion pauses for explicit approval.

- [ ] **Step 2: Implement review nodes**

Implement:

- `review.collectEvidence`
- `review.groupFindings`
- `review.createRevisionPlan`
- `review.askApproval`
- `review.saveSession`

- [ ] **Step 3: Implement memory nodes**

Implement:

- `memory.detectPreferenceCandidate`
- `memory.askPromotionApproval`
- `memory.promotePreference`

Memory promotion must write to the existing local design-review database or a
clearly versioned successor store.

- [ ] **Step 4: Add compatibility wrappers**

Old comment/review tools should delegate to the review graph where possible or
read graph artifacts.

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/core/nodes/review src/core/nodes/memory src/planning/test/design-comments.test.ts src/planning/test/design-review.test.ts src/db/test/design-review-db.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/core/nodes/review src/core/nodes/memory src/planning src/db/design-review-db.ts src/mcp/tools/design-comments.ts src/mcp/tools/design-review.ts
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

- [ ] **Step 1: Write failing trust policy tests**

Tests:

- project flow is ignored when project flows are disabled;
- enabled project flow must declare allowed capabilities;
- extension flow without allowlist is rejected;
- extension flow hash mismatch is rejected;
- active run persists graph hash and manifest hash.

- [ ] **Step 2: Extend config schema**

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

- [ ] **Step 3: Enforce trust policy in compiler/catalog**

Project and extension flows must fail closed before execution.

- [ ] **Step 4: Verify**

Run:

```bash
bun test src/core/flows/test/trust-policy.test.ts src/config/test
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/config src/core/flows src/core/graph docs/modules/config.md
git commit -m "feat(core): add flow pack trust policy"
```

## Task 11: Add Codex And Claude Plugin Wrappers

**Files:**

- Create: `plugins/codex/.codex-plugin/plugin.json`
- Create: `plugins/codex/skills/kotikit/SKILL.md`
- Create: `plugins/claude/.claude-plugin/plugin.json`
- Create: `plugins/claude/skills/kotikit/SKILL.md`
- Create: `plugins/README.md`
- Create: `src/setup/test/plugin-manifests.test.ts`
- Modify: `src/setup/scaffold-agents.ts`
- Modify: `docs/getting-started.md`

- [ ] **Step 1: Write failing plugin manifest tests**

Tests:

- Codex plugin manifest exists and references the shared MCP server;
- Claude plugin manifest exists and references the shared MCP server;
- plugin skills contain designer-facing launch instructions;
- manifests do not hardcode user-specific absolute paths;
- source installer remains available for local development.

- [ ] **Step 2: Add Codex plugin wrapper**

Add Codex plugin manifest with:

- name `kotikit`;
- version from package or manually synced package version;
- bundled skill;
- MCP server config that launches shared `kotikit-mcp`.

- [ ] **Step 3: Add Claude plugin wrapper**

Add Claude plugin manifest with:

- name `kotikit`;
- version matching package;
- bundled skill;
- MCP server config that launches shared `kotikit-mcp`.

- [ ] **Step 4: Keep scaffold as compatibility installer**

Update scaffold docs and notes:

- plugins are preferred when available;
- scaffold remains useful for repo development and manual MCP setup;
- default setup no longer positions PAT as required for draft creation.

- [ ] **Step 5: Verify**

Run:

```bash
bun test src/setup/test/plugin-manifests.test.ts src/setup/test/scaffold-agents.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Write failing stale-surface tests**

Tests:

- public MCP tool list contains the small facade;
- public MCP tool list does not contain removed old choreography tools;
- compatibility aliases still present, if any, are explicitly marked
  deprecated;
- token measurement script no longer measures deleted tools.

- [ ] **Step 2: Remove manual workflow router**

Delete `src/workflow/*` only after all graph-backed flow tests pass.

- [ ] **Step 3: Remove or internalize old tool files**

Remove public registration for:

- old workflow tools;
- old brainstorm/spec/flow tools after brief graph wrappers are removed;
- old component-plan public tool;
- old plan-design/design-screen/design-apply public tools after draft graph
  exposes artifacts;
- old review/comment public sprawl after review graph facade works.

Keep internal domain engines if graph nodes still call them.

- [ ] **Step 4: Verify no stale imports**

Run:

```bash
rg "src/workflow|kotikit_workflow_|kotikit_brainstorm_|kotikit_spec_|kotikit_flow_create|kotikit_component_plan_create|kotikit_plan_design|kotikit_design_get_screen" src docs README.md KOTIKIT_MIGRATION.md
```

Expected: only migration-history references and explicit deprecation notes
remain.

- [ ] **Step 5: Run unused-code check**

Run:

```bash
bun run check:unused
```

Expected: inspect report and remove unused graph-migration leftovers that are
part of this slice. Do not remove unrelated pre-existing unused exports without
separate approval.

- [ ] **Step 6: Verify**

Run:

```bash
bun test
bun run typecheck
bun run check
bun run measure
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src docs README.md KOTIKIT_MIGRATION.md scripts
git commit -m "refactor(mcp): remove stale workflow tool choreography"
```

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

- [ ] **Step 1: Write doc scan tests**

Add or update a documentation scan test that checks:

- design-to-code is not described as core;
- setup docs say plugins are preferred and scaffold is compatibility;
- PAT is advanced for local sync/search, not required for draft happy path;
- local design-system cache remains documented as primary token-efficient
  grounding;
- old tool names are absent from live user docs except migration/deprecation
  notes.

- [ ] **Step 2: Rewrite README**

README should describe:

- designer-first flow kit;
- built-in flows;
- local design-system cache retained;
- Figma remote MCP happy path;
- plugin installation direction;
- current alpha status;
- design-to-code removed.

- [ ] **Step 3: Rewrite getting started**

Structure:

1. Install kotikit plugin or use local scaffold for development.
2. Connect Figma remote MCP for draft creation.
3. Optional PAT setup for local design-system sync/search and comments.
4. Run first brief flow.
5. Run first draft flow.
6. Run review flow.

- [ ] **Step 4: Rewrite architecture and tools docs**

Architecture should center graph runtime and adapters.

Tools doc should list the small facade and move old tool names to a migration
history section only if still needed.

- [ ] **Step 5: Rewrite skills**

Skills should instruct agents to use the facade:

- list or start flows;
- answer graph interrupts;
- fetch artifacts;
- search local design-system cache;
- use official Figma MCP for writes;
- record apply metadata.

- [ ] **Step 6: Verify docs**

Run:

```bash
bun test src/test/tooling-config.test.ts
bun run check
rg "design-to-code|codegen|scaffold React|kotikit_workflow_|kotikit_plan_design|kotikit_design_get_screen" README.md docs .agents
```

Expected: only approved migration-history or explicit non-core references.

- [ ] **Step 7: Commit**

```bash
git add README.md KOTIKIT_MIGRATION.md docs .agents
git commit -m "docs: document platform flow kit architecture"
```

## Task 14: Add End-To-End Graph Smoke Tests

**Files:**

- Create: `e2e/graph/brief-flow.test.ts`
- Create: `e2e/graph/draft-flow.test.ts`
- Create: `e2e/graph/review-flow.test.ts`
- Create: `e2e/graph/fixtures/fake-figma.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing e2e tests**

Tests:

- brief flow starts, asks, answers, approves, saves brief artifact;
- draft flow loads approved brief, searches local design-system fixture,
  creates apply packet, waits for fake apply metadata, verifies invariants;
- review flow gathers fake comments, builds revision plan, pauses before
  posting comments or memory promotion.

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
- Built-in brief, design-system grounding, draft, and review flows exist.
- Local design-system search remains the primary grounding adapter.
- Figma remote MCP is used as the default draft creation write path.
- PAT setup is not required for draft creation happy path.
- PAT setup remains documented for local sync/search and REST comments/review.
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
