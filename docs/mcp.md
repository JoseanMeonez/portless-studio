# Connect AI agents to Portless Studio

Agents such as Claude Code and Cursor start dev servers for you, and each one lands on a random
port. `portless-studio mcp` lets those agents see and control what Studio sees: list routes and
unnamed ports, give a port a name like `web.myapp`, rename or remove it, stop a dev server, check
the setup and start or stop the proxy. They can also run commands in Studio terminals, so you
watch a dev server's logs in the dashboard while the agent reads them too, and bring Studio to the
front showing what they are talking about.

It is an [MCP](https://modelcontextprotocol.io) server, the protocol agents use to call outside
tools. It runs over stdio: the agent starts `portless-studio mcp` as a child process and talks to
it through stdin and stdout.

The MCP server does not change anything itself. It calls the HTTP API of the Studio already running
on your machine, so every change an agent makes shows up in the dashboard at once, the same way a
change made in the UI does.

## Before you start

- Studio must be running: `portless-studio`, or `portless-studio service install` to start it when
  you log in. If it is not running, every tool answers with an error telling the agent to ask you
  to start it. The MCP server never starts Studio on its own.
- The MCP server finds Studio at `http://127.0.0.1:<port>`, with the port from Studio's config file
  (`portless-studio config` shows it; the default is 4949). Set `PORTLESS_STUDIO_URL` to point it
  somewhere else, e.g. `PORTLESS_STUDIO_URL=http://127.0.0.1:5000`.

## Claude Code

Add it for every project:

```bash
claude mcp add --scope user portless-studio -- portless-studio mcp
```

Or for one project only, in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "portless-studio": {
      "command": "portless-studio",
      "args": ["mcp"]
    }
  }
}
```

## Cursor

In `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` in one project:

```json
{
  "mcpServers": {
    "portless-studio": {
      "command": "portless-studio",
      "args": ["mcp"]
    }
  }
}
```

## Any other MCP client

Configure a stdio server with the command `portless-studio` and the argument `mcp`. To pass a
different Studio address, add the environment variable `PORTLESS_STUDIO_URL`. The server speaks
protocol version `2025-06-18` and offers tools only.

If `portless-studio` is not on the agent's `PATH`, use the full path that `which portless-studio`
prints as the command.

## Tools

| Tool                  | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `list_routes`         | Named routes: name, URL, port, kind, health, project, worktree, pid     |
| `list_detected_ports` | Ports that answer HTTP and have no name: process, folder, suggestion   |
| `name_port`           | Names a port (`port`, `name`, optional `replace`)                       |
| `rename_route`        | Renames a route named by hand (`name`, `new_name`)                     |
| `remove_route`        | Removes a name; the dev server keeps running (`name`)                  |
| `name_all_detected`   | Names every detected port that has a suggested name                    |
| `stop_server`         | Stops the process behind a `pid` or `port`; needs `confirm: true`      |
| `doctor`              | Runs the health checks, with the fix for each problem                  |
| `proxy`               | Starts, stops or restarts the portless proxy (`action`)                |
| `get_config`          | Reads Studio's settings and the path of the config file                |
| `set_auto_name`       | Turns automatic naming of new dev servers on or off (`enabled`)        |
| `run_in_terminal`     | Runs a command in a Studio terminal (`command`, `project` or `cwd`, optional `name`, `name_port`, `title`) and names the port it opens |
| `list_terminals`      | Terminals: id, folder, command, running or exit code, the port named   |
| `read_terminal`       | Output as plain text (`id`, optional `from`, `max_bytes`), with the offset to read from next |
| `send_to_terminal`    | Types into a terminal (`id`, `text`, `enter` defaults to true)          |
| `stop_terminal`       | Stops a terminal's command; needs `confirm: true`                      |
| `focus_studio`        | Brings Studio to the front showing a route, project, terminal or `port:<n>` (`target`) |

Every tool answers with one summary line followed by the data as compact JSON.

`stop_server` ends a process, so it refuses to run unless the agent passes `confirm: true`; the
description tells the agent to ask you first. Studio still only stops your own user's processes
that listen on a port it shows.

`run_in_terminal` runs in a folder the agent names, as you; the agent can already do that in its
own shell, and Studio shows you what runs. `stop_terminal` asks for `confirm: true` like
`stop_server`. Terminals, how commands run and the limits are in docs/terminals.md.

## Instructions for your agent

Paste this into `CLAUDE.md`, `AGENTS.md` or your agent's rules file:

```markdown
## Local dev servers

This machine runs Portless Studio, which gives dev servers stable URLs such as
http://web.myapp.localhost:1355. Use the `portless-studio` MCP tools for them:

- After starting a dev server, call `list_detected_ports` and name it with `name_port`, using
  the suggested name unless I asked for another one. Name ports through these tools, never by
  editing portless files, so the Studio dashboard updates at once.
- Make every name say what the work is: start it with the ticket key, PR number or a short task
  name, e.g. `ed-1234.web.myapp` or `pr-87.web.myapp`, so two worktrees of the same repository
  are told apart. Rename a generic name with `rename_route`.
- To find which ports a git worktree uses, call `list_routes` and `list_detected_ports` and
  filter by the `worktree` field.
- Start dev servers with `run_in_terminal`, or `portless-studio run -- <command>` from a shell,
  never in your own background shell, so I can watch them in Studio. Read their output with
  `read_terminal`.
- When I ask to see a server, its logs or Studio, call `focus_studio` with the route, project or
  terminal id.
- Give me the route URL, not `localhost:<port>`.
- Ask me before calling `stop_server` or `stop_terminal`.
```

## The same data from a terminal or script

The CLI prints JSON too, without an MCP client:

```bash
portless-studio list --json     # routes and ports without a name
portless-studio doctor --json   # health checks; exit code 1 when one fails
portless-studio config --json   # settings and the config file path
portless-studio run -- pnpm dev # run in a Studio terminal, print its output, name its port
portless-studio open web.myapp  # bring Studio to the front showing a route, project or terminal
```

`list` reads from the running Studio. When Studio is not running it reads portless and scans the
ports directly, and its JSON says `"source": "local"` instead of `"studio"`.
