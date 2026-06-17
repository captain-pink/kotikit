# kotikit - Claude Code guide

This file is the Claude Code wrapper for kotikit. The shared agent workflow
lives in `docs/agent_workflow.md`.

When a designer types `/kotikit:auto`, read `docs/agent_workflow.md` and follow
it exactly. Keep the conversation plain-language and product-focused. Do not
show tool names, JSON, schemas, internal paths, or git terminology unless the
designer explicitly asks.

## MCP Server Setup

Kotikit runs as a local stdio MCP server. Add it to Claude Code's MCP
configuration so Claude can call the kotikit tools.

Server command:

```bash
bun run /path/to/kotikit/src/mcp/server.ts
```

Replace `/path/to/kotikit` with the absolute path to this repository.

Claude Code MCP config (`.claude/mcp.json` or the equivalent local MCP config
file):

```json
{
  "mcpServers": {
    "kotikit": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/kotikit/src/mcp/server.ts"]
    }
  }
}
```

After adding the config, restart Claude Code. The `kotikit_*` tools will become
available, and `/kotikit:auto` can use the shared workflow.

Requirements:

- Bun must be installed.
- The kotikit project must have dependencies installed with `bun install`.
- The target project should have kotikit configured. Running `/kotikit:auto`
  handles first-time setup.
