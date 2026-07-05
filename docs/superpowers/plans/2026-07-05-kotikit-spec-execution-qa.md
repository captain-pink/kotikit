# Kotikit Spec Execution And QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve explicit blueprints through create/refine graph flows and QA the actual Figma output against blueprint content.

**Architecture:** Reuse existing flows and contracts. Add small spec-execution branches inside existing brief/UX/QA nodes, expose existing Zod schemas as MCP resources, and improve shared error formatting. No new graph, no page-specific rules, no heavy quality contract.

**Tech Stack:** TypeScript, Bun, Zod v4, MCP facade resources, existing kotikit graph nodes.

---

## File Structure

- `src/util/result.ts` formats `ZodError` as field-level tool errors.
- `src/mcp/server.ts` maps `ZodError` to MCP invalid params.
- `src/core/schemas/blueprint.ts` adds optional `expectedContent`.
- `src/core/nodes/brief/index.ts` preserves expected content and uses quick lane for explicit blueprints.
- `src/core/domain/ux-envelope.ts` supports explicit-blueprint planning without archetype inference.
- `src/core/nodes/ux/index.ts` passes explicit-blueprint context and emits execution-oriented approach text.
- `src/core/domain/ui-quality-gate.ts` adds expected-content QA.
- `src/core/nodes/qa/index.ts` passes screen expected content and evidence snapshots to QA.
- `src/mcp/facade/resources.ts` exposes JSON schema resources.
- Tests live beside the touched modules.
- `docs/tools.md` documents the schema resources and expected-content QA.

## Tasks

### Task 1: Precise Validation Errors

- [ ] Write failing tests in `src/util/test/result.test.ts` and `src/mcp/test/server-errors.test.ts` for Zod field-path messages.
- [ ] Run:
  `bun test src/util/test/result.test.ts src/mcp/test/server-errors.test.ts`
  Expected: tests fail because Zod errors are still generic.
- [ ] Implement Zod formatting in `src/util/result.ts` and `src/mcp/server.ts`.
- [ ] Rerun the same tests and verify they pass.
- [ ] Commit: `fix(mcp): surface schema validation details`.

### Task 2: Blueprint Expected Content Schema And Brief Preservation

- [ ] Write failing tests in `src/core/schemas/test/blueprint.test.ts` and `src/core/nodes/brief/test/brief-nodes.test.ts`.
- [ ] Verify `expectedContent` parses and is preserved in `screen`.
- [ ] Verify explicit blueprint classification uses quick lane and does not default missing states to generic loading/empty/error.
- [ ] Run:
  `bun test src/core/schemas/test/blueprint.test.ts src/core/nodes/brief/test/brief-nodes.test.ts`
  Expected: tests fail before implementation.
- [ ] Implement schema and brief node changes.
- [ ] Rerun the same tests and verify they pass.
- [ ] Commit: `feat(brief): preserve explicit blueprint content`.

### Task 3: Spec-Execution UX Behavior

- [ ] Write failing tests in `src/core/nodes/ux/test/ux-nodes.test.ts`.
- [ ] Verify explicit blueprint/table wording does not infer `admin-data-table` without traits or pattern pack ids.
- [ ] Verify explicit blueprint approach says to execute the supplied blueprint and does not frame the work as generic ideation.
- [ ] Run:
  `bun test src/core/nodes/ux/test/ux-nodes.test.ts`
  Expected: tests fail before implementation.
- [ ] Implement explicit-blueprint branches in UX domain/node code.
- [ ] Rerun the same tests and verify they pass.
- [ ] Commit: `feat(ux): execute explicit blueprints without archetype drift`.

### Task 4: Spec Structural QA

- [ ] Write failing tests in `src/core/nodes/qa/test/qa-nodes.test.ts`.
- [ ] Verify QA blocks when required expected content is missing from evidence text nodes.
- [ ] Verify QA passes when required expected content appears in evidence text nodes.
- [ ] Run:
  `bun test src/core/nodes/qa/test/qa-nodes.test.ts`
  Expected: tests fail before implementation.
- [ ] Implement expected-content check in `src/core/domain/ui-quality-gate.ts` and pass data from `src/core/nodes/qa/index.ts`.
- [ ] Rerun the same tests and verify they pass.
- [ ] Commit: `feat(qa): compare explicit blueprint content with figma evidence`.

### Task 5: Schema Resources And Docs

- [ ] Write failing tests in `src/mcp/facade/test/resources.test.ts`.
- [ ] Verify resource templates include blueprint/canvas/inventory schemas and reading a schema returns JSON.
- [ ] Run:
  `bun test src/mcp/facade/test/resources.test.ts`
  Expected: tests fail before implementation.
- [ ] Implement schema resources in `src/mcp/facade/resources.ts`.
- [ ] Update `docs/tools.md`.
- [ ] Rerun the same tests and verify they pass.
- [ ] Commit: `feat(mcp): expose graph input schemas`.

### Task 6: Integration Verification

- [ ] Run focused tests:
  `bun test src/util/test/result.test.ts src/mcp/test/server-errors.test.ts src/core/schemas/test/blueprint.test.ts src/core/nodes/brief/test/brief-nodes.test.ts src/core/nodes/ux/test/ux-nodes.test.ts src/core/nodes/qa/test/qa-nodes.test.ts src/mcp/facade/test/resources.test.ts`
- [ ] Run graph and facade regression tests:
  `bun test e2e/graph/create-screen-flow.test.ts e2e/graph/refine-existing-flow.test.ts src/mcp/facade/test/tools.test.ts`
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run check`.
- [ ] Run full `bun test`.
- [ ] Commit any docs/test cleanup if needed.

## Self-Review

- Spec coverage: the plan covers validation errors, schema resources,
  spec-execution mode, structural QA, and docs.
- Deferred items are explicitly out of scope: richer component metadata, theme
  summary, and local quality uplift loop.
- The plan keeps behavior generic and evidence-based, with no product-specific
  or page-specific rules.
