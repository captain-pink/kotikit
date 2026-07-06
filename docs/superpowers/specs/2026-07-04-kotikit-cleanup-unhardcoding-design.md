# Kotikit Cleanup And Hardcoding Removal Design

## Context

Kotikit has moved toward blueprint-first create/refine flows, local
design-system evidence, and explicit graph artifacts. The next cleanup should
apply the same philosophy across the repository: remove brittle product-shaped
rules, simplify oversized modules, and reduce migration-era test weight without
weakening safety.

This is a research/spec phase. It does not authorize implementation yet.

## Goal

Make kotikit easier to evolve by removing core logic that narrows designer
intent into fixed templates, splitting oversized modules by responsibility, and
trimming stale tests while preserving real behavior, safety, and local
design-system guarantees.

## Non-Goals

- Do not rewrite the whole architecture.
- Do not remove QA, schema validation, graph durability, secret-safety, or Figma
  evidence gates just because they are strict.
- Do not delete tests based on line count alone.
- Do not change public MCP behavior without a migration note and focused tests.
- Do not introduce LLM calls into kotikit core to replace deterministic logic.

## Guideline Update

`docs/coding_guidelines.md` now defines a medium/large module layout:

- `index.ts`: public surface or graph node orchestration.
- `types.ts`: module-local exported types and interfaces.
- `constants.ts`: named literals, enum-like arrays, policy limits, lookup
  tables, and TypeScript enums.
- `helpers.ts`, `utils.ts`, or specific files such as `matching.ts` and
  `metadata.ts`: pure transformations.
- `schema.ts`/`schemas.ts`: module-local Zod schemas that are not persisted
  cross-module contracts.

Tiny files should not be split mechanically. Split when helpers obscure the
main behavior, constants drive policy, or tests need pure functions without
constructing a whole graph node or MCP handler.

The guidelines also set two cleanup standards:

- New files should stay at or below 400 lines. Existing files over 400 lines
  should not grow unless the same change reduces or isolates a larger concern,
  or the commit explains why splitting would create more churn than clarity.
- Exported functions, class methods, graph node runners, MCP handlers, domain
  planners, and nontrivial local helpers need a short one- or two-line
  description that says what the function does or why it exists. Descriptions
  must be useful, not line-by-line narration.

## Cleanup Criteria

### Remove Or Redesign

- Product-specific or workflow-specific vocabulary in core logic that changes
  title, classification, UI structure, component selection, icon choice, state
  planning, canvas mode, or variable bindings.
- Keyword/substring classifiers that treat incidental words as design intent.
- Hardcoded UI packages such as table rows, pagination, avatars, row menus,
  form fields, or admin dashboards unless provided by explicit blueprint,
  pattern pack, local design-system evidence, or user/project configuration.
- Tests that only assert removed migration artifacts stay removed when the same
  guarantee is already covered by a higher-level public contract.
- Duplicate `.not.toContain(...)` tests for old tool names, old docs, or old
  scaffolding once a single manifest/public-surface test covers the boundary.
- Test fixtures that duplicate the same large object without adding behavior
  coverage.
- Unused exports, stale compatibility modules, and empty legacy directories.

### Keep Strict

- Schema versions, persisted artifact validation, graph state validation, and
  JSON schema export sync.
- Secret redaction, friendly error handling, path safety, local filesystem
  boundaries, MCP safety annotations, and auto-approval allowlists.
- Figma target validation, transaction metadata matching, node ledger
  integrity, screenshot/evidence requirements, and QA gates.
- Local design-system source policy for production graph execution.
- External API protocol handling, retry/backoff policy, rate limits, and Figma
  REST error mapping.
- Tests for data loss prevention, resume safety, security, external protocol
  compatibility, and public MCP behavior.

## Hardcoding Taxonomy

1. **Intent-shaping hardcoding:** substring rules that decide what the designer
   meant. These are highest priority to remove or replace with explicit input.
2. **Design-shaping hardcoding:** fixed UI parts, icons, variables, layouts, or
   states chosen from labels instead of blueprints, traits, pattern packs, or
   local DS evidence.
3. **Policy hardcoding:** safety limits, allowlists, schema versions, protocol
   codes, retry limits. These should usually remain, but move to named
   constants and tests.
4. **Compatibility hardcoding:** old tool names, old docs, old migration
   exclusions. These are cleanup candidates after one public contract test
   remains.
5. **Fixture hardcoding:** repeated test data and large mock payloads. These
   should move to focused fixture builders.

## Current Research Findings

- TypeScript files under `src`, `e2e`, and `test`: 41,921 total lines.
- Largest implementation files:
  - `src/mcp/facade/tools.ts`: 1,378 lines.
  - `src/core/nodes/figma/index.ts`: 1,215 lines.
  - `src/core/nodes/design-system/index.ts`: 1,025 lines.
  - `src/core/schemas/artifact.ts`: 924 lines.
  - `src/core/nodes/brief/index.ts`: 731 lines.
  - `src/core/graph/runtime.ts`: 591 lines.
  - `src/core/domain/ui-quality-gate.ts`: 460 lines.
- Largest test files:
  - `src/core/nodes/figma/test/figma-nodes.test.ts`: 1,388 lines.
  - `src/sync/test/sync-engine.test.ts`: 1,275 lines.
  - `src/mcp/facade/test/tools.test.ts`: 1,160 lines.
  - `src/core/nodes/design-system/test/design-system-nodes.test.ts`: 958 lines.
  - `src/core/domain/test/canvas-plan.test.ts`: 787 lines.
  - `src/core/nodes/draft/test/draft-nodes.test.ts`: 710 lines.
  - `src/core/nodes/ui-composition/test/ui-composition-nodes.test.ts`: 652
    lines.
- `bun run check:unused` currently reports:
  - unused export `BlueprintTraitsSchema` in `src/core/schemas/blueprint.ts`.
  - `knip.json` configuration hint for `ignoreBinaries.show`.
- Many `.not.*` assertions are legitimate security/public-boundary tests, but
  several clusters are migration guardrails that can likely be consolidated:
  - scaffold and plugin tests repeatedly asserting old code-generation language
    is absent.
  - MCP instruction/tool tests repeatedly asserting removed choreography tool
    names are absent.
  - flow registry tests repeatedly asserting old optional flows/nodes are
    absent.
  - docs tests asserting old UX/comment workflow language is absent.

## Proposed Cleanup Strategy

### Recommended Approach: Module-By-Module Cleanup With Guardrails

Work one module at a time. For each module:

1. Build a module inventory: source files, tests, public contracts, generated
   artifacts, and docs.
2. Classify hardcoded rules using the taxonomy above.
3. Decide whether each rule is product-shaping, design-shaping, safety policy,
   compatibility, or fixture setup.
4. Write or preserve tests for public behavior and safety.
5. Delete or consolidate stale negative tests.
6. Split oversized files only where it improves boundaries.
7. Run targeted tests, `bun run check`, and full `bun test` at checkpoints.

This approach is slower than a broad rewrite but safer for a tool that already
has graph persistence, Figma transaction state, local DS indexes, and public MCP
contracts.

### Alternative: Test Diet First

Start by pruning redundant tests across the repo. This gives quick line-count
reduction but is riskier because stale implementation may be left in place and
real behavioral coverage can be accidentally removed.

### Alternative: Hardcoding Search And Rewrite First

Search for `includes`, regexes, fixed arrays, and enum branches, then rewrite
them. This is fast but too blunt: many of those conditions are protocol parsing,
schema validation, or safety checks that should stay strict.

## Test Pruning Policy

A test may be removed or consolidated only when at least one condition is true:

- It asserts an old implementation detail that no public API can observe.
- It duplicates another test in the same file with only fixture names changed.
- It asserts absence of legacy wording/tool names already covered by a single
  public surface test.
- It exists only because of a migration that has completed and the migration
  path is no longer supported.
- It covers a helper that will disappear after moving behavior behind a clearer
  contract.

A test should stay when it protects:

- public MCP tool names, input schemas, output shape, or safety annotations;
- persisted schema compatibility;
- graph resume safety and checkpoint behavior;
- local design-system cache behavior;
- secret redaction or friendly error messages;
- Figma transaction ordering, evidence validation, or QA gates;
- bug regressions that can still recur.

## E2E Review Policy

The E2E suite should prove realistic graph workflows, not every internal state.
Keep smoke tests that cover:

- create new screen from explicit blueprint;
- refine existing frame from explicit inventory;
- graph resume after Figma metadata;
- local DS sync/search end-to-end;
- bridge/server protocol basics.

Avoid E2E tests that reassert unit-level details such as every generated field,
every test fixture token, or every old deleted tool name.

## Risks

- Removing negative migration tests too aggressively can reintroduce old public
  surfaces.
- Splitting files without changing behavior can still create churn and merge
  risk.
- Replacing heuristics with explicit contracts may require MCP/tool docs and
  agent skill updates.
- Some hardcoded strings are valid protocol constants. They should be named and
  isolated, not removed.

## Success Criteria

- The module inventory is complete enough that each cleanup task has known
  source and test files.
- Core product intent is driven by blueprints, traits, pattern packs, local DS
  evidence, configuration, or explicit answers.
- No broad substring classifier can force a bespoke UI template from incidental
  vocabulary.
- Large modules have clearer boundaries for types, constants, schemas, and
  helpers.
- New and touched files follow the 400-line target or document why a temporary
  exception is safer.
- Public functions, graph nodes, MCP handlers, planners, and nontrivial helpers
  have concise purpose descriptions.
- Redundant migration tests are consolidated, not blindly deleted.
- `bun run check`, `bunx --bun tsc --noEmit`, and `bun test` pass after every
  completed cleanup slice.
