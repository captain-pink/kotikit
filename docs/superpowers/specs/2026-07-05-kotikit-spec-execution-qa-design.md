# Kotikit Spec Execution And QA Design

## Goal

Make kotikit easier for agents to use when the designer already supplied a
complete structured spec or blueprint. The graph should preserve that spec,
avoid generic ideation detours, expose input schemas, return actionable input
errors, and QA the actual built frame against explicit required content.

## Constraints

- Keep kotikit lightweight, fast, robust, and designer-first.
- Do not add product-specific, screen-specific, or archetype-specific rules.
- Use local design-system evidence and typed contracts instead of keyword
  classifiers.
- Keep Figma MCP calls bounded; prefer local schema and graph checks.
- Use TDD for behavior changes.
- Use only mocked product, company, customer, and user data in tests.

## Design

### Spec-Execution Mode

Existing `create-screen` and `refine-existing` flows stay in place. When
`screenBlueprint` or `flowBlueprint` is provided with non-low confidence, core
nodes switch to spec-execution behavior:

- brief lane becomes `quick` so complete blueprints do not pause for generic
  brief approval;
- blueprint title, domain, UI parts, states, traits, and expected content are
  preserved;
- UX approach describes executing the supplied blueprint, not brainstorming a
  new product direction;
- UX envelope stays `unknown` unless explicit composable traits or
  `patternPackIds` select a pattern pack;
- state planning uses explicit blueprint states only and does not invent
  loading/empty/error coverage for complete blueprints.

### Schema Resources

Agents should not guess `kotikit_start` input shapes. Add MCP resources for the
local JSON schemas:

- `kotikit://schemas/screen-blueprint-input`
- `kotikit://schemas/flow-blueprint-input`
- `kotikit://schemas/canvas-intent-input`
- `kotikit://schemas/existing-design-inventory-input`

These are read-only, compact, and generated from the same Zod schemas used at
runtime.

### Precise Validation Errors

Tool input schema failures should be user-actionable. `toolError` and MCP
request errors should format Zod issues with the field path and validation
message, for example:

```text
Input validation failed: input.existingDesignInventory Invalid input: expected object, received string.
```

Unknown system errors remain generic and stack-safe.

### Blueprint Expected-Content QA

Add optional `expectedContent` to screen blueprints:

```ts
{
  kind?: "field-label" | "column-label" | "toggle-label" | "button-label" | "copy" | "region-title" | "custom";
  text: string;
  required?: boolean;
}
```

When present, `qa.runUiQualityGate` compares required expected text against
compact scanner evidence (`evidenceSnapshots[].textNodes` or
`evidenceSnapshots[].texts`). It reports exact missing strings. This validates
that a supplied spec survived into the frame without adding page-specific rules.

### Deferred Work

The following are important but not part of this first implementation slice:

- richer local component metadata for slot gotchas and full property guidance;
- one-call theme/token summary from `variables.json`;
- bounded local quality uplift pass after Figma scan;
- more scanner fields for literal/token/layout uplift.

These should be implemented after the spec-execution and structural QA
foundation is stable.

## Acceptance Criteria

- Complete explicit blueprint starts use quick/spec-execution behavior.
- Explicit blueprint without states does not receive generic default states.
- Explicit blueprint with table-like parts does not force
  `admin-data-table` unless a pattern pack is explicitly selected.
- MCP resources expose input schemas for agents.
- Malformed facade input returns a field-level validation error.
- Blueprint expected content is blocked by QA when missing from scanner text
  evidence and passes when present.
- Existing generic QA behavior remains intact.
