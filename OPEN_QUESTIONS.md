# Kotikit — Open Questions

> What has been decided, and what still needs an answer. Questions made obsolete by the move to mutable specs have been removed. The new questions are written in the same uncomfortable, ask-the-thing-nobody-wants-to-ask style — because the answers shape the architecture.

---

## Part A — Decided

These are settled. Recorded here so the decisions and their reasoning don't get re-litigated every two weeks.

### A1. Who is this for, and what is the business model?
**Decided.** Open-source, GitHub-hosted, no monetization. Primary user is the UX/UI designer who is currently punished for being "too slow" and unable to ship code. Kotikit gives them ownership of the entire UI surface — design *and* frontend. Must work for teams of 1 to 200. Front-end engineers can use it too if the flow is clean enough, but the designer is the north star.

### A2. Are there competitors to worry about (Zeplin, Supernova, Knapsack)?
**Decided — reframed.** It is not a product competing for a market; it is a productivity tool. It deliberately does *not* demand process change: keep Figma, keep your framework (React or whatever). The only precondition is "you have components on at least one side." If components are in Figma, generate code. If components are in code, generate a design system. If both, audit the mismatches. The differentiator is ruthless token efficiency — never read a whole database, always search and pull exactly what's needed.

### A3. Are specs immutable?
**Decided — NO.** Specs are mutable. Git is the history. No content hashing, no lock ledger, no `mark-production`, no supersede chains, no compliance overrides, no recall path. If a spec is wrong, edit it and regenerate. If it's dead, delete the file. The team owns keeping specs current. This deletes an entire class of complexity (old Q6, Q7, Q8, Q9, Q11, Q23, Q27 — gone).

### A4. What is the spec lifecycle?
**Decided.** Two states: `draft` → `active`. Draft = being brainstormed. Active = used by a plan or implementation. Mutable throughout. Nothing else.

### A5. What is the spec granularity?
**Decided.** Flow-level or page-level. A spec is a full flow (checkout, onboarding) or a full page (profile, settings). Small widgets (date picker, toast) are NOT specs — they are steps inside a plan. (The exact rule for a 5-screen flow is still open — see B1.)

### A6. How are specs organized on disk?
**Decided — flow-based subfolders.** Each spec gets its own folder named after the flow: `.kotikit/specs/checkout-flow/`. A standalone page is a flow of length one. Reasoning: it matches how designers think, it's the same unit as the spec itself (so the folder *is* the spec's home), it plays perfectly with git (one flow = one directory's history), and it avoids the endless "which bucket?" argument that feature-based and page-based organizations create. Plans live inside the same folder and are disposable.

### A7. Are plans first-class artifacts?
**Decided — NO, ephemeral.** Plans are generated from a spec on demand to break work into steps, then thrown away. They live next to the spec (`code.plan.json`, `design.plan.json`) for convenience during implementation, but they are disposable. When a spec changes, you regenerate the plan — nothing migrates.

### A8. How deep is the brainstorm agent?
**Decided — deep.** No "ask 3–5 questions." The agent hunts for implementation pitfalls, visual edge cases, accessibility requirements, and state variations, and keeps asking until the spec is unambiguous. The literal quality bar: *any developer or designer could implement it identically from the spec alone.*

### A9. Whose responsibility is code quality?
**Decided — the framework's, 100%.** The user is a designer with no developer reviewing their PRs. Generated code is production-grade by construction: TypeScript strict (no `any`), ARIA/semantic HTML, full keyboard nav, responsive, error boundaries, no unnecessary re-renders. Enforced by generation prompts + static gates (tsc, eslint jsx-a11y) + runtime gates (Chrome DevTools, Playwright). (Whether the bar is configurable per project is open — see B4.)

### A10. How is correctness validated?
**Decided.** Integration tests are generated from the spec's acceptance criteria when `implement code` runs, covering the flow/page. Executed via Playwright. If acceptance criteria are too vague to test, the brainstorm agent failed.

### A11. Which design tool?
**Decided — Figma only.** No Sketch, Penpot, Lottie, or "no tool" path. This is a deliberate strategic choice, not an accident. The architecture should not leave half-doors open for other tools.

### A12. Can there be multiple design-system files?
**Decided — yes.** All file keys are cached in `.kotikit/config.json`. Sync pulls every file and merges them into one local `design-system/` snapshot. Name collisions: later-listed file wins, conflict recorded in the sync report.

### A13. How is the design system kept fresh?
**Decided.** Sync runs on a schedule and can be triggered manually (`/sync-ds`).

### A14. How are icons handled at scale (1000+)?
**Decided — flat `icons.db` SQLite (FTS5) table.** No per-icon files, no folders, no 10k-token manifest. Query by name prefix (`SELECT name, key FROM icons WHERE name MATCH 'arrow*'`), get back only matches. The "flat manifest" idea is realized as a searchable index, not a loadable file.

### A15. How is the 500+ component manifest kept token-cheap?
**Decided.** `components.db` (SQLite FTS5) is the search surface. The agent runs `SELECT name, path FROM components WHERE name MATCH 'button*'`, gets a handful of rows, then reads individual component JSONs by path. `manifest.json` is tiny metadata and is never parsed for lookups. Loading a 50–100KB manifest into context is explicitly forbidden.

### A16. How are Figma rate limits handled during sync?
**Decided.** bottleneck (rate cap) + exponential backoff with jitter (429/5xx) + checkpoint/resume (`.sync-checkpoint.json`) so a failed sync resumes instead of re-fetching.

### A17. How is the Figma token secured?
**Decided.** Baseline: git-ignored `.env`. Team upgrade: 1Password CLI — `config.json` may use `op://vault/item/field` syntax, resolved at runtime via `op read`. Recommended for teams since designers are not security experts. Token never written to a committed file.

### A18. What frameworks are supported?
**Decided.** React-first (tested with React + shadcn/ui), architected framework-agnostic. All framework-specific code lives behind `codegen/adapter.ts`; Vue/Svelte adapters can be added later without touching the planner, spec engine, registry, or search.

### A19. Where do the project's code components live?
**Decided — a `/components` folder** (path configurable via `codeComponentsDir`). The drift audit compares `design-system/components/` against this folder. Monorepo-package and published-npm cases are not specially handled in V1.

### A20. How is design↔code drift handled?
**Decided.** A drift audit runs on schedule and manually. It writes a small `design-system/audit-report.json`, then walks mismatches one at a time and asks the user which side is canonical; kotikit then fixes the chosen direction. A lightweight component-mismatch list (not token-heavy) drives this. (Exact richness of the diff is open — see B3.)

### A21. CI/CD integration?
**Decided — none.** Keep it simple. Everything runs locally or in the designer's Claude Code session.

### A22. What is the exit strategy / lock-in?
**Decided — zero lock-in, intentional and documented.** Specs are JSON/markdown in git; design-system data is local JSON/SQLite. If kotikit is abandoned, the team keeps fully compatible designs, code, and specs — delete the `.kotikit/` folder and carry on. Optional nicety: export specs to Notion/Confluence format.

---

## Part B — Still Open

These need answers before the relevant phase is built. They are uncomfortable on purpose.

### B1. What is the granularity rule for a multi-screen flow?
A "checkout flow" has five screens: cart, shipping, payment, review, confirmation. Is that **one spec** describing the whole flow, or **five specs**, one per screen? The plan currently leans "one spec per flow, with a `screens` array," but that is an assertion, not a rule. Where exactly is the line? If a flow has 20 screens, is it still one spec? Is the rule "one spec per flow, period," or "one spec per flow unless it exceeds N screens, then split"? If you don't pin this down, two designers will spec the same checkout three different ways and the audit will think half of it is missing. **Give me the rule, not a vibe.**

Answer: That's a good question. What if we do spec per screen then? User will describe flow and how it should work, then we will generate small file like feature-spec-manifest.json where we say connect each screen with each other and then create a separate spec for each screen. Would it work better? analyze and decide if that is viable approach as I'm not a designer, I'm software engineer who is buliding for desginers.

### B2. How does a designer actually open kotikit?
Be honest: typing `/brainstorm` into a terminal-based Claude Code session is a technical wall for most designers. The entire premise is "this is for designers, not developers" — but the front door is a CLI. So which is it? Either (a) the real target is "technical designers" who are comfortable in a terminal, and we say that out loud and stop pretending otherwise, or (b) there is a roadmap item for a friendlier surface — a VS Code extension, a desktop GUI, a local web UI. You cannot claim "for designers who can't code" and ship a tool whose only interface is a coder's terminal. **Pick the story and commit to it, because it changes who you build for.**

Answer: Designers will claude code in the vs code as well as figma plugin. It will allow them to work in the exactly one place. It should be possible to run this plugin with a single command like /kotikit:auto and then it automatically uses everything and designer just answering questions. Like "What you want to build?" "How/Why/Etc?"

### B3. What is the minimum viable content of the mismatch report?
The audit report has to be small (tokens), but small and useless is worse than slightly-bigger and decisive. Just names that don't have a counterpart? Or also variant/prop differences (`DS Variant=[Primary,Secondary,Destructive,Ghost]` vs `code variant=[primary,secondary]`)? Casing differences? Missing states? The richer the report, the more tokens to generate and display *and* the more it costs every scheduled run. **What is the minimum diff that still lets the user confidently pick the canonical side?** My instinct: name + type-of-mismatch + a one-line prop delta, nothing more. Confirm or correct.

Answer: Confirmed your approach.

### B4. Is the quality baseline fixed or configurable per project?
"Production-grade" means one thing on a startup landing page and a very different thing on a fintech dashboard. The plan ships a fixed default bar (TS strict, WCAG-AA-ish, a11y, tests). But is there a configurable quality profile per project — `accessibility: wcag-aa | wcag-aaa`, `typescript: strict`, `test-coverage: 80%`, `performance-budget: ...` — in `config.json`? Or is the baseline fixed for V1 and tuned later? **If configurable, decide the knobs now**, because they leak into the generation prompts and the gates; bolting them on after the codegen is written is painful.

Answer: Let's go with best practices regarding TS strict, WCAG-AA-ish, a11y, tests. We should also try to create units and integration tests per screen, but tests should be optional as not all teams might use them. But they should be turned on by default.

### B5. Is the code-first → design path in V1 scope?
You said "if they have components in the code, we should be able to create a design system from them." That is a full reverse-engineering track: parse code → infer each component's API/variants → generate Figma frames via the API. It is meaningfully harder than design-first and it is a *separate* engine, not a flag on the existing one. The plan currently defers it explicitly and lets the *audit* handle the "you already have both sides" case. **Confirm the deferral.** If you actually want code→Figma generation in V1, it needs its own phase and probably doubles the codegen surface — say so now, not in month three.

Answer: Lets go from design system -> code components generation now. we will add vice verca later. We want quick solution now with narrowed path to proof the point that it might work like that. If that works, we will extend it. 

### B6. What is the designer's git workflow — and should kotikit drive it?
Most designers do not use git. But specs live in `.kotikit/` and only become "history" if they are committed. So either the designer learns commit/push (friction, and the whole "for non-coders" story wobbles again — see B2), or **kotikit drives git for them.** If kotikit auto-commits spec changes: what is the commit message format (proposed: `kotikit: update spec <scope>`)? Does it auto-push, or only commit locally? Does it ever create branches, or always commit to the current one? Does it commit on every spec edit, or batch? Getting this wrong means either a designer loses work they thought was saved, or kotikit makes noisy commits in a shared repo that engineers hate. **Decide the exact behavior and make it opt-in or opt-out explicitly.**

Answer: kotikit should handle auto commits and should use conventional commits as an approach. But it should also say in the bottom of the description somthing like: coauthored claude-code bla bla lb

### B7. Should dark mode and responsive breakpoints be global config inherited by every spec?
Every single spec will mention breakpoints and themes. Repeating `[375, 768, 1024, 1440]` and `["light", "dark"]` in every spec file is duplication that will drift the moment someone adds a breakpoint and forgets to update 30 specs. The plan leans toward defining them once in `.kotikit/config.json` and having every spec inherit them, with per-spec override only when a spec genuinely differs. **Confirm that's the model.** Open sub-question: when a spec *does* override (e.g. an embed that only supports mobile), how is that expressed without re-stating the global defaults — an explicit `overrides` block, or full restatement? Inheritance with a small override block is the clean answer, but it needs to be settled before the spec schema freezes.

Answer: yes, we should definitely have some small but dynamic and extensible config for such cases. Subanswer: Inheritance with a small override block is the clean answer.
