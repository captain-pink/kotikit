# Kotikit Plugin Wrappers

Kotikit ships lightweight assistant plugin wrappers around the same shared MCP
server:

- `plugins/codex/kotikit` packages the Codex plugin manifest, skill, and MCP
  config.
- `plugins/claude/kotikit` packages the Claude plugin manifest, skill, and MCP
  config.

Both wrappers launch `kotikit-mcp`, so plugin installation assumes the kotikit
package is installed or linked in a way that exposes `kotikit-mcp` on `PATH`.
The core MCP server stays agent-neutral, so the plugin layer only adds
assistant-specific packaging and designer-facing launch instructions.

Use plugin installation when your assistant supports local plugins. Use
`bun run scaffold:agents` for local development, source checkouts, or manual MCP
setup in a target workspace.
