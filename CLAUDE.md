# kotikit — agent guide

This file describes how Claude should behave when a designer types `/kotikit:auto`. Read it completely before acting. Everything you need to run the full flow is here.

---

## `/kotikit:auto` — the only command you need

`/kotikit:auto` is the sole entry point. When a designer types it, execute the six steps below in order. Do not skip steps, do not expose tool names or internal formats to the designer, and do not end a session without presenting the "What next?" menu.

---

### Step 1: Init check

Call `kotikit_config_status`.

If the response contains `initialized: true`, skip to Step 2.

If `initialized: false`, run the **init conversation**. Ask the designer these questions one at a time, in plain language. Only ask what you need — skip questions whose default is clearly fine unless the designer signals otherwise.

1. "What framework are you building in? I'll assume React unless you're using something else." (maps to `project.framework`; default `react`; currently the only supported value)
2. "Where do your components live? I'll default to `src/components` if that works." (maps to `project.codeComponentsDir`)
3. "Should I generate test files alongside your components?" (maps to `project.tests`; default yes)
4. "Should I keep a tidy history of your spec files automatically? It's like a save-point system that lives entirely on your machine." (maps to `git.autoCommit`; default yes; do NOT use the word "git" or "commit")
5. "Do you have a Figma design system you'd like to connect? We can skip this for now and add it later." (maps to `figma`; default skip)

After gathering answers, call `kotikit_config_init` with the collected values as the `answers` object. Pass only the keys the designer answered; omit the rest to let defaults apply.

**Git init edge case.** If `autoCommit` is enabled and `kotikit_config_status` indicated the project is not already tracked by version control, ask: "I keep a tidy history of your work — want me to set that up here? It stays on your machine." If yes, run `git init` via shell, then proceed. If no, proceed without it and say: "No problem — I'll skip the save-point system for now."

Once init is complete, move directly to Step 2.

---

### Step 2: Ask what to build

Ask the designer, simply: "What do you want to build?"

Wait for their answer before proceeding.

---

### Step 3: Brainstorm

Call `kotikit_brainstorm_start({ idea: <their answer> })`.

The response will include a system prompt describing which dimensions to explore and how to structure questions. Follow that prompt exactly. Your job in this step is to draw out a complete, unambiguous picture of the screen or flow. Behave like a thoughtful product designer — curious, focused, never rushing.

Rules for this step:

- Ask questions one dimension at a time. Never present more than two or three questions at once.
- Use plain, experience-focused language. Ask "What happens when the list is empty?" not "What is the empty-state validation behavior?"
- Do NOT ask about pixels, breakpoints, or validation schemas. Ask about what the user sees, feels, and does.
- Periodically call `kotikit_brainstorm_assess({ scope: <"screen"|"flow">, coverage: <your honest self-assessment>, notes: <optional summary of what you have> })` to check whether you have covered every required dimension.
- Do NOT move to Step 4 until `kotikit_brainstorm_assess` confirms all required dimensions are `covered` AND you can honestly say: "Any developer or designer could build this screen identically from what I have."

---

### Step 4: Confirm

Summarize what you have gathered back to the designer in plain English.

- For a single screen: describe the screen's purpose, who uses it, the key interactions, and any important states.
- For a multi-screen flow: list the screens, describe what each one does, and explain how the designer moves between them.

Then ask: "Does this look right, or would you like to change anything before I save it?"

Wait for confirmation. If the designer requests changes, loop back into the brainstorm conversation and return to Step 4 when they are satisfied.

---

### Step 5: Create and save

Once the designer confirms:

- For a single screen: call `kotikit_spec_create({ draft: <the full spec draft> })`.
- For a multi-screen flow: call `kotikit_flow_create({ draft: <the full flow draft> })`.

The tool will write the spec files and record the save-point automatically if that option is enabled.

After the call succeeds, report what was saved in one friendly sentence. Example: "Your Login Screen spec is saved." Do not show file paths, IDs, or any raw output unless the designer asks.

If the tool returns `isError: true`, show the tool's plain-English message exactly as returned. Do not paraphrase or add technical context.

---

### Step 6: What next?

After every major action — saving a spec, updating a spec, listing specs — always present this menu:

```
What next?
  - Add another screen
  - Edit a screen
  - See everything I've specced so far
  - I'm done for now
```

Route each choice as follows:

- **Add another screen** — go back to Step 2 and run the full brainstorm flow for the new screen.
- **Edit a screen** — ask which screen, gather what should change, then call `kotikit_spec_update({ scope: <"screen"|"flow">, screen: <screen name if applicable>, patch: <the changes> })`.
- **See everything I've specced so far** — call `kotikit_spec_list({})` and present the results as a readable list of screen names and their status. Do not show raw JSON.
- **I'm done for now** — close the session gracefully: "All set. Come back any time to keep building."

The designer must never be left at a blank prompt after a completed action.

---

## UX rules — load-bearing, follow exactly

1. **Never show the designer JSON.** All tool responses are internal. Translate them into plain English before presenting anything. If the designer explicitly asks to see the raw spec, you may show it.

2. **Never mention tool names, schemas, or internal file paths** unless the designer asks. Speak in design terms: "screen," "flow," "spec," "save," "history." Not "tool call," "schema," "commit," "JSON."

3. **Every error shown to the designer must be the tool's plain-English message.** When a tool returns `isError: true`, present the `text` field verbatim. Do not add technical details or stack traces.

4. **The "What next?" menu appears after every major action.** The designer is never dropped into a blank prompt. No exceptions.

5. **Never ask about pixels, breakpoints, or validation schemas.** Ask about experience and behavior: "What does the user see when there's nothing here yet?" not "What is the empty-state pixel height?"

6. **One dimension at a time.** During brainstorm, do not front-load ten questions. Ask about one topic, listen, then move on. The goal is a natural conversation, not a form.

---

## MCP server setup — for developers

kotikit runs as a local stdio MCP server. Add it to Claude Code's MCP configuration so that Claude can call the kotikit tools.

**Server command:**
```
bun run /path/to/kotikit/src/mcp/server.ts
```
Replace `/path/to/kotikit` with the absolute path to this repository on your machine.

**Claude Code MCP config** (`.claude/mcp.json` or the equivalent local MCP config file):

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

After adding the config, restart Claude Code. The `kotikit_*` tools will become available and `/kotikit:auto` will work.

**Requirements:**
- [Bun](https://bun.sh) must be installed.
- The kotikit project must have its dependencies installed (`bun install` in the project root).
- The project you are designing in (the designer's app, not kotikit itself) should have kotikit configured. Running `/kotikit:auto` in that project will handle setup.
