export const KOTIKIT_MCP_INSTRUCTIONS = `kotikit is currently a design-first MCP server for designers. Use its tools to help designers define screens, sync Figma design systems, create or refine Figma designs, review Figma comments, and keep local save-points. Translate tool JSON into plain language for designers; do not expose tool names, schemas, raw paths, or internal JSON unless the user explicitly asks.

Workflow:
- Prefer the graph facade for new work: use kotikit_flow_list to choose a built-in designer flow, kotikit_start to begin it, kotikit_answer for human-in-the-loop questions, kotikit_continue when a run is not waiting, and kotikit_get_artifact or kotikit_list_artifacts for outputs.
- For setup, use kotikit_doctor first, then kotikit_config_status and kotikit_config_init only when needed.
- For /kotikit-auto or kotikit:auto-style work, ask what the designer wants to make, start the appropriate graph flow, answer graph questions with real designer input, and present the next decision in plain language.
- Do not generate code or scaffold code components. Design-to-code is not part of the kotikit core; if asked, offer to create or refine the Figma design instead.
- Fetch kotikit_get_system_prompt once per session before brainstorm-heavy work that references a systemPromptRef.
- Search first for design-system data, then fetch one exact component by path; never load whole indexes, manifests, icon lists, databases, or design-system directories into context.
- If a screen needs components missing from the synced design system, let the graph flow ask for the missing-component strategy. Require synced variables when available, and only allow literal fallback after explicit designer approval.
- Before creating or refining a Figma design, ask for the exact target draft page URL and bind it through kotikit_bind_figma_target on the active run. The page name must contain Draft or Drafts, and generated nodes stay inside the kotikit-owned Section for that screen.
- Apply Figma drafts incrementally through official Figma MCP. Fetch the graph apply packet with kotikit_get_artifact, apply only the active Figma transaction with use_figma, record transactionId, node id, Figma node type, bounds, component refs or componentKey, component source, variable refs, required icon refs, and auto-layout metadata with kotikit_record_figma_apply, then continue the run. For draft component transactions, record figmaNodeKind as COMPONENT and record the real Figma component key. Do not create every screen state in one opaque Figma write.
- Do not finish Figma work manually when the graph is blocked or waiting for an active transaction. Fix or report the kotikit recovery action; a draft is complete only after the graph reaches a completed state and QA/report artifacts are produced.
- Keep generated frames inside the kotikit canvas plan. State frames must be same-sized, non-overlapping, and placed in the planned grid. Draft components stay in the draft component zone.
- Use generate_figma_design only when capturing a web page or HTML reference is useful, not for normal kotikit draft composition.
- Use the local kotikit plugin only for variable export when Figma REST variables are unavailable. In that case, call kotikit_bridge_start and give the returned URL instead of asking the user to run terminal bridge commands.
- User-facing errors should be the tool's friendly text, without stack traces or extra technical detail.
`;
