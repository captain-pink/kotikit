# kotikit - Claude Code guide

This file is the repo-local Claude Code wrapper for kotikit. Target projects
should use the portable skill installed at
`.claude/skills/kotikit-auto/SKILL.md`.

When a designer types `/kotikit-auto`, follow the portable skill workflow. Keep
the conversation plain-language and product-focused. Do not show tool names,
JSON, schemas, internal paths, or git terminology unless the designer explicitly
asks.

## MCP Server Setup

Kotikit runs as a local stdio MCP server. Add it to Claude Code's MCP
configuration so Claude can call the kotikit tools.

Server command:

```bash
bun run /path/to/kotikit/src/mcp/server.ts
```

Replace `/path/to/kotikit` with the absolute path to this repository.

Claude Code project MCP config (`.mcp.json` in the target project):

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
available, and `/kotikit-auto` can use the shared workflow. The local scaffold
command installs that skill into a target project automatically:

```bash
bun run scaffold:agents -- --target /path/to/target-react-project --agents claude
```

Requirements:

- Bun must be installed.
- The kotikit project must have dependencies installed with `bun install`.
- The target project should have kotikit configured. Running `/kotikit-auto`
  handles first-time setup.
