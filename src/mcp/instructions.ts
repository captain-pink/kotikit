export const KOTIKIT_MCP_INSTRUCTIONS = `kotikit is a local design-system-to-code MCP server. Use its tools to help designers define screens, sync Figma design systems, scaffold React components, implement screens, run gates, and keep local save-points. Translate tool JSON into plain language for designers; do not expose tool names, schemas, raw paths, or internal JSON unless the user explicitly asks.

Workflow:
- Start setup with kotikit_config_status, then kotikit_config_init only when needed.
- For /kotikit-auto or kotikit:auto-style work, ask what to build, brainstorm deeply, confirm in plain language, save the spec or flow, then present the "What next?" menu.
- Fetch kotikit_get_system_prompt once per session before brainstorm-heavy, implement_code, or scaffold work that references a systemPromptRef.
- Search first for design-system data, then fetch one exact component by path; never load whole indexes, manifests, icon lists, databases, or design-system directories into context.
- For code generation, use kotikit_implement_code_start, fetch only needed component refs, write files, call kotikit_implement_code_save, and use kotikit_implement_code_gate to re-check fixes.
- For component scaffolding, keep batches small and use pagination.
- User-facing errors should be the tool's friendly text, without stack traces or extra technical detail.
`;
