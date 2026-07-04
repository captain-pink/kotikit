# Kotikit Cleanup And Hardcoding Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean kotikit’s core and support modules so behavior stays lightweight, generic, designer-first, local-DS-driven, and easier to maintain.

**Architecture:** This is a master cleanup plan. Execute it module-by-module, preserving public behavior and safety gates while removing product-shaping hardcoding, redundant migration tests, unused code, and oversized mixed-responsibility files. Every implementation slice must follow `AGENTS.md`, kotikit’s philosophy, and `docs/coding_guidelines.md`.

**Tech Stack:** TypeScript, Zod, Bun, Bun test runner, Knip, Biome, cspell, kotikit graph runtime, MCP facade.

---

## Ground Rules

- [ ] Before each implementation slice, reread `AGENTS.md` and `docs/coding_guidelines.md`.
- [ ] Keep kotikit lightweight, fast, designer-first, agent-neutral, local-first, and generic-before-specific.
- [ ] Use TDD for behavior changes: add/update a focused failing test first.
- [ ] Keep new files at or below 400 lines.
- [ ] When touching files over 400 lines, split the touched concern into focused files or document why that slice is an exception.
- [ ] Add concise one- or two-line descriptions for exported functions, graph node runners, MCP handlers, domain planners, and nontrivial helpers touched in the slice.
- [ ] Do not remove strict safety, schema, protocol, Figma evidence, local DS, or secret-redaction gates.
- [ ] Make atomic Conventional Commits after each completed slice.

## Cleanup Criteria

Remove or redesign:

- [ ] substring/keyword logic that shapes designer intent, UI parts, icons, variables, states, canvas mode, or archetype;
- [ ] fixed UI templates not backed by blueprint input, pattern packs, local DS evidence, config, or explicit user/project input;
- [ ] stale migration guards already covered by one public contract test;
- [ ] duplicated negative assertions that only prove removed names are absent;
- [ ] unused exports, unused files, stale compatibility modules, and repeated oversized fixtures.

Keep strict:

- [ ] Zod and JSON schema validation;
- [ ] graph persistence, checkpoints, transaction ordering, and resume safety;
- [ ] local DS source policy;
- [ ] Figma target, evidence, screenshot, node-ledger, and QA invariants;
- [ ] MCP safety annotations and secret redaction;
- [ ] external API protocol handling, retry/backoff, rate limits, and user-friendly errors.

## Module Inventory Checklist

### Core Schemas

- [ ] Source: `src/core/schemas/artifact.ts`, `blueprint.ts`, `flow-definition.ts`, `graph-state.ts`, `json-schema-export.ts`.
- [ ] Tests: `src/core/schemas/test/blueprint.test.ts`, `json-schema-export.test.ts`, `ux-quality-artifacts.test.ts`.
- [ ] Cleanup focus: split large artifact schema into artifact-family schemas if touched; remove unused exports; keep persisted schema compatibility and JSON schema sync strict.

### Core Graph And Runs

- [ ] Source: `src/core/graph/compiler.ts`, `graph-hash.ts`, `interrupts.ts`, `node-registry.ts`, `runtime.ts`; `src/core/runs/artifact-store.ts`, `checkpoint-store.ts`, `run-store.ts`, `safe-id.ts`.
- [ ] Tests: `src/core/graph/test/*.test.ts`, `src/core/runs/test/*.test.ts`.
- [ ] Cleanup focus: split runtime helpers if touched; keep checkpoint/resume and interrupt contracts strict.

### Core Flows

- [ ] Source: `src/core/flows/catalog.ts`, `src/core/flows/built-in/*.flow.json`.
- [ ] Tests: `src/core/flows/test/catalog.test.ts`, `trust-policy.test.ts`, `src/core/nodes/test/built-in-node-registry.test.ts`.
- [ ] Cleanup focus: consolidate old-flow absence assertions; keep extension/project trust policy tests.

### Core Domain

- [ ] Source: `canvas-plan.ts`, `canvas-reconciliation.ts`, `comment-evidence-map.ts`, `context-durability.ts`, `designer-recovery.ts`, `draft-component-lifecycle.ts`, `figma-evidence.ts`, `figma-transaction-plan.ts`, `layout-contract.ts`, `state-representation.ts`, `ui-composition-contract.ts`, `ui-quality-gate.ts`, `ux-envelope.ts`, `ux-pattern-pack.ts`, `variable-binding-plan.ts`.
- [ ] Tests: `src/core/domain/test/*.test.ts`, `src/core/ux-pattern-packs/test/pattern-packs.test.ts`.
- [ ] Cleanup focus: remove intent-shaping archetype fallback where possible; split `ui-quality-gate.ts` checks; keep evidence and QA strict.

### Core Nodes: Brief And UX

- [ ] Source: `src/core/nodes/brief/index.ts`, `src/core/nodes/ux/index.ts`.
- [ ] Tests: `src/core/nodes/brief/test/brief-nodes.test.ts`, `src/core/nodes/ux/test/ux-nodes.test.ts`, `src/core/domain/test/ux-envelope.test.ts`.
- [ ] Cleanup focus: move types/constants/helpers out of `index.ts`; remove remaining lane/title/UI heuristics that can be explicit input; preserve low-confidence clarification behavior.

### Core Nodes: Design System

- [ ] Source: `src/core/nodes/design-system/index.ts`; adapters `src/core/adapters/design-system/local-index.ts`, `figma-remote-search.ts`.
- [ ] Tests: `src/core/nodes/design-system/test/design-system-nodes.test.ts`, `src/core/adapters/design-system/test/local-index.test.ts`.
- [ ] Cleanup focus: split query building, semantic matching, icon matching, variable gaps, artifacts, and node definitions; replace product-shaped token maps with explicit blueprint roles, pattern refs, and local DS search evidence.

### Core Nodes: UI Composition And Draft

- [ ] Source: `src/core/nodes/ui-composition/index.ts`, `src/core/nodes/draft/index.ts`, adapter `src/core/adapters/figma/apply-packet.ts`.
- [ ] Tests: `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`, `src/core/nodes/draft/test/draft-nodes.test.ts`, `src/core/adapters/figma/test/apply-packet.test.ts`.
- [ ] Cleanup focus: split node orchestration from composition/variable helpers; remove hardcoded part roles not provided by contracts; keep replacement metadata and no-imitation checks.

### Core Nodes: Figma And QA

- [ ] Source: `src/core/nodes/figma/index.ts`, `src/core/nodes/qa/index.ts`, `src/core/domain/ui-quality-gate.ts`.
- [ ] Tests: `src/core/nodes/figma/test/figma-nodes.test.ts`, `src/core/nodes/qa/test/qa-nodes.test.ts`.
- [ ] Cleanup focus: split transaction queue, metadata parsing, ledger append, apply verification, artifact save, and QA checks; keep exact Figma evidence and target invariants.

### Core Nodes: Feedback And Refine

- [ ] Source: `src/core/nodes/feedback/index.ts`, `src/core/nodes/refine/index.ts`, `src/core/nodes/built-in-registry.ts`.
- [ ] Tests: `src/core/nodes/feedback/test/feedback-nodes.test.ts`, `src/core/nodes/refine/test/refine-nodes.test.ts`, registry tests.
- [ ] Cleanup focus: keep lightweight review/refine behavior; split only if files grow or helper concerns are touched.

### MCP Facade, Bridge, Tools

- [ ] Source: `src/mcp/facade/tools.ts`, `completions.ts`, `prompts.ts`, `resources.ts`; `src/mcp/bridge/*.ts`; `src/mcp/tools/*.ts`; `src/mcp/server.ts`, `instructions.ts`, `system-prompts.ts`, `tool-safety.ts`.
- [ ] Tests: `src/mcp/facade/test/*.test.ts`, `src/mcp/bridge/test/*.test.ts`, `src/mcp/tools/test/*.test.ts`, `src/mcp/test/*.test.ts`.
- [ ] Cleanup focus: split `tools.ts` by tool group/schema/metadata helpers; consolidate repeated old-tool negative tests; keep MCP input schemas, safety annotations, and secret handling.

### Sync And Local Design-System Data

- [ ] Source: `src/sync/*.ts`, fixtures under `src/sync/fixtures`; DB modules `src/db/*.ts`.
- [ ] Tests: `src/sync/test/*.test.ts`, `test/e2e/phase2.test.ts`, `src/db/test/*.test.ts`.
- [ ] Cleanup focus: keep protocol/retry/rate-limit strict; move large fixtures/builders; review icon/component heuristics without weakening local DS sync behavior.

### Spec, Planning, Figma Target, Setup, Doctor, Config, Migrations, Util

- [ ] Source: `src/spec/*.ts`, `src/planning/*.ts`, `src/figma/*.ts`, `src/setup/*.ts`, `src/doctor/*.ts`, `src/config/*.ts`, `src/migrations/*.ts`, `src/util/*.ts`, `src/cli.ts`.
- [ ] Tests: corresponding `test` directories plus `src/test/*.test.ts`.
- [ ] Cleanup focus: preserve legacy readable artifact support where still tested; consolidate setup/scaffold migration absence tests; keep config/secret/path safety.

### E2E And Docs

- [ ] Source/tests: `e2e/graph/*.test.ts`, `e2e/graph/fixtures/fake-figma.ts`, `test/e2e/phase2.test.ts`, `src/docs/test/ux-quality-docs.test.ts`.
- [ ] Docs: `README.md`, `docs/*.md`, `docs/modules/*.md`, `.agents/skills/kotikit-auto/SKILL.md`.
- [ ] Cleanup focus: E2E should prove realistic workflows, not every field; docs tests should protect current public surface, not every old phrase.

## Execution Phases

### Phase 0: Baseline And Health Report

- [ ] Run `git status --short`; expected clean or only approved docs/plans.
- [ ] Run `bun test`, `bun run check`, `bunx --bun tsc --noEmit`, and `bun run check:unused`.
- [ ] Capture file length report with `find src e2e test -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | sort -nr`.
- [ ] Save a short baseline note in the first cleanup commit or module PR description.

### Phase 1: Low-Risk Unused Code And Generated Config

- [ ] Remove confirmed unused exports such as `BlueprintTraitsSchema` only if no external public import depends on it.
- [ ] Fix stale Knip config hints if the config change is obvious.
- [ ] Run `bun run check:unused`, schema tests, and full `bun test`.
- [ ] Commit as `chore(cleanup): remove unused exports`.

### Phase 2: Test Diet Without Behavior Changes

- [ ] Group `.not.*` assertions into public-boundary categories: security, public API, migration guard, duplicate fixture guard.
- [ ] Keep one public contract test per removed legacy surface.
- [ ] Remove only duplicate migration guards that do not protect a current public boundary.
- [ ] Prefer fixture builders over repeated object literals.
- [ ] Run affected tests plus full `bun test`.
- [ ] Commit each module’s test diet separately, for example `test(mcp): consolidate legacy facade guards`.

### Phase 3: File Boundary Refactors

- [ ] For each file over 400 lines, split only the touched concern.
- [ ] Add purpose descriptions to exported functions, graph node runners, MCP handlers, planners, and nontrivial helpers touched during the split.
- [ ] Preserve public imports unless a module owns the whole call chain and tests are updated.
- [ ] Run targeted tests after each split.
- [ ] Commit each split separately, for example `refactor(figma): split transaction metadata helpers`.

### Phase 4: Intent And Design-Shape Hardcoding Removal

- [ ] Replace remaining intent-shaping substring rules with explicit blueprint fields, traits, pattern pack refs, config, or low-confidence clarification.
- [ ] Replace component/icon query token maps with semantic roles from blueprints, UI contracts, local DS metadata, or pattern refs.
- [ ] Keep tiny simple-prompt fallback only where tests prove it cannot hijack detailed PRDs.
- [ ] Add regression tests before changing behavior.
- [ ] Commit each behavior cleanup separately, for example `fix(ds): derive icon queries from semantic roles`.

### Phase 5: E2E Review

- [ ] Keep E2E coverage for create-screen blueprint, refine-existing inventory, graph resume, local DS sync/search, and bridge/server basics.
- [ ] Remove E2E assertions that duplicate unit tests for every generated field.
- [ ] Keep fake Figma fixtures compact and reusable.
- [ ] Run `bun test:e2e:graph`, `bun test test/e2e/phase2.test.ts`, then full `bun test`.
- [ ] Commit as `test(e2e): focus graph smoke coverage`.

### Phase 6: Final Gates

- [ ] Run `bun run check`.
- [ ] Run `bunx --bun tsc --noEmit`.
- [ ] Run `bun run check:unused`.
- [ ] Run `bun test`.
- [ ] Run `git status --short` and confirm no unrelated dirty files.
- [ ] Update docs only if public behavior or workflow changed.

## Module Slice Order

1. [ ] `src/core/schemas` and generated schemas.
2. [ ] `src/core/nodes/brief` and `src/core/domain/ux-envelope`.
3. [ ] `src/core/nodes/design-system` and design-system adapters.
4. [ ] `src/core/nodes/ui-composition`, `draft`, and Figma apply packet.
5. [ ] `src/core/nodes/figma` and `src/core/domain/ui-quality-gate`.
6. [ ] `src/mcp/facade/tools.ts`.
7. [ ] `src/mcp/tools`, bridge, instructions, and setup scaffold tests.
8. [ ] `src/sync` and `src/db`.
9. [ ] `src/spec`, `src/planning`, `src/figma`, config, doctor, migrations, util.
10. [ ] E2E and docs.

This order starts where intent/design-shaping risk is highest, then moves to
transport, sync, and legacy support modules.
