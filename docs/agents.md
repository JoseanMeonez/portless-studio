# Keep coding agents in sync with Studio

Coding agents such as Claude Code, Cursor and Codex start dev servers on their own, and each
one lands on a random port in a shell you cannot see. This page shows how to make them start dev
servers where Studio shows them, with logs you can watch and a name that says which ticket or
pull request they belong to.

There are three layers, from the one that needs no setup to the one that changes the agent's
commands:

1. **Auto mode** names every new dev server without any agent setup.
2. **The MCP server and instructions** let the agent list, name and run dev servers through
   Studio, and tell it to do so.
3. **Claude Code hooks** show the agent the current routes when a session starts, and catch dev
   server commands it runs in its own shell.

Use as many as you need. Each one works without the others.

## Auto mode needs no hooks

With auto mode on (the **Auto-name new servers** switch, or `"autoName": true` in the config),
any dev server an agent starts gets its suggested name a few seconds later, whatever shell
started it. The suggested name starts with the ticket key or branch of the git checkout it runs
in, so two worktrees of one repository get different names. [naming.md](naming.md) explains the
pattern.

What auto mode does not give you: the agent's output in the Studio terminal panel, and a name
the agent chose. The next two sections add those.

## MCP server and agent instructions

Set up the MCP server first: [mcp.md](mcp.md) has the command for Claude Code, the file for
Cursor and the settings for any other client. For Claude Code, for every project:

```bash
claude mcp add --scope user portless-studio -- portless-studio mcp
```

Then tell the agent how to use it. Paste this into `CLAUDE.md`, `AGENTS.md` or your agent's rules
file, and replace the example names with your own pattern:

```markdown
## Local dev servers

This machine runs Portless Studio, which gives dev servers stable URLs such as
http://pr-87.web.myapp.localhost:1355 and shows their logs in a dashboard.

- Start dev servers with the `run_in_terminal` MCP tool, or from a shell with
  `portless-studio run --name <ticket>.<app> -- <command>`, for example
  `portless-studio run --name pr-87.web -- pnpm dev`. Never start a dev server in a hidden
  background shell; I want to watch it in Studio.
- Name every port after the ticket key or pull request number first, then the app, such as
  `ed-1234.web.myapp` or `pr-87.web.myapp`. When a server already runs without a name, call
  `list_detected_ports` and name it with `name_port`.
- Read a server's output with `read_terminal`, not by starting it again.
- Give me the route URL, not `localhost:<port>`.
- Never stop or kill a process you did not start. Ask me before calling `stop_server` or
  `stop_terminal`.
```

`portless-studio run` blocks until the command ends and prints its output, so an agent that uses
it from a shell should run it as a background command and read the output from Studio with
`read_terminal`, or from the background command's output.

## Claude Code hooks

Hooks are commands Claude Code runs at fixed points of a session. They live under `hooks` in a
settings file: `~/.claude/settings.json` for every project, or `.claude/settings.json` in one
project. The formats below follow the
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks); check it if a hook does not
fire, since the format can change between Claude Code versions.

### Show the current routes when a session starts

A `SessionStart` hook's plain output is added to the agent's context before your first message.
`portless-studio list` prints the named routes and the ports without a name. When Studio is not
running it reads portless and the system directly, so the hook works either way:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "portless-studio list 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

`list --json` gives the same data as JSON with the fields `source`, `proxy`, `routes` and
`detected`, if you prefer to filter it with `jq` first.

### Send dev server commands through Studio

A `PreToolUse` hook on the `Bash` tool sees every shell command before it runs. There are two
ways to use it for dev servers.

**Block and explain (simplest).** The hook exits with code 2 and its message goes back to the
agent, which then runs the command the way the message says. Save it as
`.claude/hooks/studio-dev-server.sh` and make it executable (`chmod +x`):

```bash
#!/usr/bin/env bash
# Stops dev server commands that bypass Studio and tells the agent what to run instead.
cmd=$(jq -r '.tool_input.command // ""')
pattern='^((pnpm|npm|yarn|bun)( run)? dev|(npx )?vite|(npx )?next dev)( |$)'
if [[ "$cmd" =~ $pattern ]]; then
  echo "Run dev servers through Studio: portless-studio run -- $cmd" >&2
  exit 2
fi
exit 0
```

**Rewrite the command.** A `PreToolUse` hook can also print JSON with `updatedInput`, which
replaces the tool's input before it runs. This version wraps the command in
`portless-studio run` and runs it in the background, and asks you to confirm the new command
(`"ask"`; change it to `"allow"` to skip the prompt). `updatedInput` replaces the whole input, so
the hook copies the original fields and changes only `command` and `run_in_background`:

```bash
#!/usr/bin/env bash
# Rewrites dev server commands into `portless-studio run -- <command>`.
input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
pattern='^((pnpm|npm|yarn|bun)( run)? dev|(npx )?vite|(npx )?next dev)( |$)'
if [[ "$cmd" =~ $pattern ]]; then
  jq '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Run the dev server in a Studio terminal",
      updatedInput: (.tool_input + {
        command: ("portless-studio run -- " + (.tool_input.command | @sh)),
        run_in_background: true
      })
    }
  }' <<<"$input"
fi
exit 0
```

The command is passed to `run` as one quoted word, which `run` hands to the shell as written, so
`&&` and pipes inside it keep working.

Register either script for the `Bash` tool:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/studio-dev-server.sh"
          }
        ]
      }
    ]
  }
}
```

Both scripts need `jq`. The pattern only matches commands that start with a dev server command;
extend it for your tools (`astro dev`, `rails server`, `python manage.py runserver`). Commands
that already start with `portless-studio` never match, so the hook does not wrap a command twice.

## Cursor

Add the MCP server in `~/.cursor/mcp.json` or `.cursor/mcp.json` ([mcp.md](mcp.md#cursor)), then
put the instructions above in `AGENTS.md` at the project root or in a rule under
`.cursor/rules/`. The hook scripts above use Claude Code's format and do not run in Cursor as
they are; turn on auto mode so dev servers Cursor starts get a name anyway.

## Other MCP clients

Any client that runs stdio MCP servers works: configure the command `portless-studio` with the
argument `mcp` ([mcp.md](mcp.md#any-other-mcp-client)), and paste the instructions into whatever
file the agent reads for project rules. An agent without MCP can still use the CLI:
`portless-studio list --json` to see routes, and `portless-studio run -- <command>` to start dev
servers.
