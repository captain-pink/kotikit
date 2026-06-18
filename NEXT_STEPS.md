# Next steps

What kotikit could grow into. Each item is bite-sized enough to spawn as its own follow-up phase or pull request.

Sorted from highest leverage downward within each section.

## Token efficiency (highest leverage)

AI coding assistants have conversation budgets; today's defaults are conservative but there's room to go further.

- **MCP protocol `cache_control` markers** — when Anthropic ships caching for tool results, retrofit kotikit responses to mark static prefixes as cached. See `docs/TOKENS.md` for current limits.
- **Tool-call streaming for large bundles** — return scaffold components one-by-one over a streaming JSON-RPC instead of paginated round-trips.
- **Session-aware deduplication** — kotikit remembers what it sent each agent session and avoids re-sending the same DS component JSON twice.
- **Per-user token budget enforcement** — refuse tool calls that would exceed a configured per-call token limit; surface as a friendly error with the suggested compact/pageSize override.
- **Compress payloads via shared schema references** — when responses repeat structural keys, deflate using a session-scoped schema id.

## Code track

The React adapter ships and is exercised, but the boundary it implies hasn't been validated.

- **Vue and Svelte adapters** behind the same `Adapter` interface — confirms the boundary holds, validates `qualityGates()` and `verifyEnvironment()` for non-React toolchains.
- **Custom adapter slot in `config.json`** so projects can ship their own adapter (e.g. native React Native, Solid).
- **Per-project quality profile** — WCAG-AAA, performance budgets, custom ESLint rules — configured in `config.project.quality`.
- **Server-side rendering profile** for Next.js + React Server Components — different `use client` rules, different test scaffolds.
- **Codemod-driven migrations** — when shadcn ships a breaking change, kotikit can apply a codemod across `<codeComponentsDir>/ui/`.
- **Auto-fix mode for gate failures** — `implement_code_save` retries with one auto-fix pass (e.g. add missing `aria-label`) before failing the gate.

## Design track

Phase 5 ships the bridge + the orchestrator + a placeholder UI. The plan-checklist UI was deferred (P5-D4). Browserless comment reading, compact review reporting, reply outbox support, and explicit design preference promotion now exist; the remaining items make that loop more automatic and visual.

- **Full plan-checklist UI in the Figma plugin** — the deferred P5-D4 task: two-pane view with per-step Run buttons + streaming status log.
- **Automatic feedback clustering** — infer `preferenceKey` suggestions from similar comment/adjustment text instead of relying on the agent to provide a stable key.
- **Comment thread inheritance** — map replies without `client_meta.node_id` through their parent comment when the parent is mapped, while still returning truly detached comments as unmapped.
- **Coordinate fallback for unmapped comments** — investigate whether frame-relative `client_meta` offsets can be matched against generated node bounds in the node map. Keep it conservative: only map when the geometry is unambiguous.
- **Official resolve support if Figma exposes it** — if Figma adds a REST endpoint for resolving comments, add a confirm-first tool that marks threads resolved after replies are posted.
- **Review dashboard in the plugin** — show mapped and unmapped comments beside the apply-plan status so designers can inspect review feedback without switching tools.
- **Preference lifecycle controls** — add dismiss, deactivate, and edit flows for active design preferences so stale taste does not accumulate.
- **Multi-project bridge selector** inside the plugin — list of running bridges instead of a single-paste connect URL.
- **Flow-level Figma prototype connections** — read `flow.json` transitions and wire them as Figma prototype arrows.
- **Variable binding with `nodeNameHint` resolution** — bind a variable to a specific child node (e.g. "Heading text") instead of the frame itself.
- **Bidirectional sync** — edits in Figma flow back into `.kotikit/specs/`. Major scope; deferred since Phase 5.
- **Real-time collaboration** — multiple designers, one bridge, conflict resolution.
- **Design-side gates** — auto-layout sanity, missing variables, components without DS keys.

## Design-system sync hardening

The published-library normalizer now handles the major shapes seen so far:
standalone components, component sets, flattened variant rows, sparse
component-set metadata, state groups, and icon pages. The remaining work is to
prove and refine that behavior against a broader library corpus. Each item
should be implemented test-first with minimized fixtures, not large live Figma
payloads.

- **Published-library fixture corpus** — add minimized fixtures for several real published design systems: MUI / Material 3, Ant-style kits, shadcn-like Figma kits, small hand-built libraries, and intentionally messy copied libraries. Store only the API fields the normalizer needs.
- **Normalizer snapshot tests** — assert logical component count, icon count, representative import key, `componentSetKey`, variant axes, text/boolean/instance-swap properties, warnings, and duplicate-name behavior for every fixture.
- **Default variant resolution** — improve representative key selection by resolving the component-set default variant when Figma exposes enough data. Keep `ComponentJson.key` importable, but make the chosen default deterministic and explainable.
- **Property-name cleanup** — normalize Figma property labels such as `Label#42169:37` into readable names while preserving the original Figma property key needed for `setProperties`.
- **Configurable icon classification** — keep the current page/prefix/slash classifier, but add project-level include/exclude patterns and confidence diagnostics so icon-heavy or icon-named component libraries can avoid false positives.
- **Duplicate logical name policy** — move beyond last-file-wins for large multi-library setups: expose namespace hints, configurable priority, and clear conflict output before rows overwrite each other.
- **Normalization diagnostics report** — write compact per-file metrics: published components seen, logical groups emitted, groups classified as icons, inferred variant groups, missing metadata groups, duplicate names, and sampled warnings.
- **Importability smoke check** — add an optional Figma-plugin smoke path that verifies a small set of synced component keys can be imported into a draft. This should be opt-in because it needs a live Figma session.
- **Component-set import evaluation** — investigate whether importing component sets directly is reliable enough to support. Until then, keep storing concrete component keys as `ComponentJson.key` and component-set keys as metadata.
- **Schema-drift guardrails** — add tests for unknown Figma property types and new/extra API fields so future Figma changes degrade with warnings instead of breaking sync.

## Audit (post-Phase 6)

The variant-name diff catches most renames. Richer signals are deferred.

- **Prop-type comparison** — not just variant names; verify `disabled?: boolean` matches the DS's BOOLEAN property of the same name.
- **Runtime audit via Chrome DevTools MCP composition** — open the scaffolded story in a real browser, screenshot, compare against Figma component thumbnail.
- **Audit auto-runs as a pre-commit hook** — fail commits that introduce drift.
- **Audit-fix flow** — "I'd like to reconcile the Card mismatch — kotikit, do it" → kotikit regenerates code or updates DS spec, asks for confirmation, commits.
- **Cross-file collision audit** — find DS components with the same name across configured Figma files (already surfaced in `manifest.json.conflicts[]`; promote to the audit report).

## Documentation + onboarding

The README assumes the designer can install Bun. Real designers often hit walls earlier.

- **Production-quality agent autoinstaller** — build on the local MVP `bun run scaffold:agents` command. Add interactive prompts, dry-run/diff output, explicit overwrite confirmation, backup/rollback notes, stronger existing-config conflict handling, cross-platform path validation, and a smoke check that starts the MCP server and calls `kotikit_config_status`.
- **Published `create-kotikit` package** — ship a `bunx create-kotikit` / `npx create-kotikit` flow that detects the target React project, configures Claude Code, Codex, or both, installs or links the Codex skill, handles `.env` safely, and prints exact restart/verification steps.
- **Video walkthrough of the first hour** — recorded once, evergreen.
- **Per-tool examples that include real Figma file links** — readers can fork and run the exact flow.
- **A diagram of the data flow** in the README (spec → plan → code → registry → audit).
- **Per-spec / per-flow templates** — "I want to build a SaaS dashboard" pre-seeds a flow with common screens.

## Architecture (longer-term)

The single-direction Figma → code assumption is core; eventually it might bend.

- **Code → Figma reverse path** — V2+ explicit. Requires a Figma plugin that mutates the file, which the current plugin doesn't do.
- **Headless mode for CI** — drop the MCP server, expose a CLI that runs sync + audit + gates in one shot.
- **Multi-project / monorepo config inheritance** — root config + per-package overrides.
- **A "kotikit-cli"** — for engineers who prefer the terminal to assistant chat for routine ops (`kotikit sync`, `kotikit audit`).
- **Backend / data layer integration** — currently kotikit stops at the UI; a future phase could wire spec acceptance criteria into typed API contracts.
- **Replace SQLite with a single shared database** for multi-project setups.

## Tooling + DX

Smaller items that polish the developer experience.

- **A `kotikit doctor` command** that diagnoses common setup issues (missing token, missing gates, stale checkpoint, etc.).
- **A `kotikit clean` command** that prunes ephemeral artifacts (plans, checkpoints) safely.
- **Telemetry-free crash reporting** — when a tool throws, write a structured trace next to the spec for the user to share.
- **Better agent transcript IDs** — embed tool result IDs so users can ask "what was that error in spec_create earlier?" and the assistant can find it.

---

If you implement any of these, link the PR back to this file with `[done in #PR]`.
