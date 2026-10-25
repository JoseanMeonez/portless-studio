# portless studio

[![npm](https://img.shields.io/npm/v/portless-studio)](https://www.npmjs.com/package/portless-studio)
[![CI](https://github.com/keven-bardales/portless-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/keven-bardales/portless-studio/actions/workflows/ci.yml)

A local web dashboard for [portless](https://github.com/vercel-labs/portless): see every dev server
on your machine, give each one a name like `web.myapp.localhost`, and open it from one page.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/dashboard-dark.png">
  <img alt="The Studio dashboard: detected ports without a name at the top, named routes grouped by project below, each with its branch, folder, port and uptime" src="docs/images/dashboard-light.png" width="1280">
</picture>

portless replaces port numbers with names: `portless api pnpm dev` serves your app at
`http://api.localhost:1355` instead of `http://localhost:3000`. It has no interface of its own, so
with ten dev servers across several projects you have to remember which names exist and which
ports have none. Studio shows both, live, and names a port in one click.

![Naming port 8000, searching routes with Ctrl+K, filtering with the Filter popover and running pnpm dev in a Studio terminal](docs/images/demo.gif)

The screenshots use the built-in sample data (`?demo`), not a real machine.

## Install

Requirements: Node 22 or later on Linux, macOS or Windows. portless is installed for you if it is
missing.

To try it, run it straight from npm:

```bash
npx portless-studio init
```

For everyday use, and always for "start at login", install it globally:

```bash
npm i -g portless-studio
portless-studio init
```

The login service starts Studio from the files npm installed. Run through `npx`, those files sit in
npm's cache, which npm can clear at any time, and then Studio stops starting at login.

To update, install the latest version and restart Studio with `npm i -g portless-studio@latest`.
To remove it, run `portless-studio uninstall`, then `npm rm -g portless-studio`.

## Quick start

`init` asks a few questions and leaves everything working:

- Checks that portless is installed and offers to install it with `npm install -g portless`.
- Asks for the basic settings (auto mode, start at login, port, open the browser) and saves them.
- Finds the dev servers already running, suggests a name for each and names them in portless.
- Starts the portless proxy on port 1355 over HTTP, which needs no password, certificate or extra
  tool on macOS, Windows or Linux, and can set Studio to start when you log in.

Then `portless-studio` starts Studio at `http://127.0.0.1:4949`, registers it in portless as
`studio` and opens your browser. Your apps open at names like `http://web.myapp.localhost:1355`:
Chrome, Edge and Firefox send every `*.localhost` name to your own machine, with no hosts file and
no DNS setup.

[Getting started](docs/getting-started.md) walks through the first five minutes: naming a dev
server, naming a port by hand, running a command in a Studio terminal and turning on auto mode.
To try the page without portless, open `http://127.0.0.1:4949/?demo` for sample data.

## What it does

- **Live list** of portless routes: name, URL, port, app or alias, uptime and any Tailscale, ngrok
  or Cloudflare tunnel. It updates as soon as a route appears or goes away.
- **Detected ports:** listening ports that answer HTTP but have no name yet, with the process, the
  project folder and a suggested name. Name one, name them all, or ignore one. Ports a running
  Docker container publishes show here too.
- **Auto mode** (off by default): every new dev server gets its suggested name by itself. Names
  auto mode gave are removed 10 minutes after their port closes.
- **Name a port** that portless did not start, such as a database in Docker (`db` gives
  `db.localhost`). Rename or remove those names later.
- **Where each server runs:** every row shows the git branch, the linked worktree and the project
  folder.
- **Views:** group by project, worktree, kind or status, or into your own groups; filter, sort and
  save the combination as a named view.
- **Terminals:** run a command per project inside Studio and watch its output in a panel. You, the
  CLI and your AI agents drive the same terminals.
- **Agents:** an MCP server lets Claude Code, Cursor and other agents list, name and stop dev
  servers and run commands in Studio terminals.
- **Health:** each route's dot says whether its port answers, and `portless-studio doctor` finds a
  proxy left running as root, two proxies at once, an untrusted certificate or a taken port, and
  gives the fix.
- **Keyboard first:** every action has a key, `?` lists them and `Ctrl+K` (`Cmd+K`) runs any of
  them by name.

Also: start, stop or restart the proxy and Studio from the page, stop a dev server from its row,
open a project in your editor, project icons, and notifications in the page or from the operating
system.

## Naming

A suggested name says what the work is, then the app, then the repository. The package
`@acme/web` in the `acme-monorepo` folder on the branch `feat/ED-1234-add-x` gets
`ed-1234.web.acme`, so two worktrees of one repository get different names. Change the pattern
with `nameTemplate`; [docs/naming.md](docs/naming.md) lists every token.

Anything that names a route through the portless CLI also shows up in Studio:

```bash
portless web.myapp pnpm dev       # a dev server, at web.myapp.localhost
portless alias db.myapp 5432      # a port something else opened, at db.myapp.localhost
```

## Agents and terminals

```bash
claude mcp add --scope user portless-studio -- npx -y portless-studio mcp
portless-studio run -- pnpm dev
```

The first line connects Claude Code to Studio's MCP server. The second runs a dev server in a
Studio terminal, prints its output in your shell and names the port it opens.
[docs/agents.md](docs/agents.md) shows how to keep agents in sync with Studio, including
instructions to paste and Claude Code hooks; [docs/mcp.md](docs/mcp.md) has the setup for other
clients and [docs/terminals.md](docs/terminals.md) covers the terminal panel.

## Documentation

- [Getting started](docs/getting-started.md) and [Troubleshooting](docs/troubleshooting.md)
- [Command line](docs/cli.md), [Configuration](docs/configuration.md) and
  [Keyboard shortcuts](docs/keyboard-shortcuts.md)
- [Naming](docs/naming.md), [Terminals](docs/terminals.md) and
  [Linux, macOS and Windows](docs/platforms.md)
- [Agents](docs/agents.md) and [MCP server](docs/mcp.md)
- [Every page, with one line each](docs/README.md)

## How it relates to portless

Studio is an independent project, not part of portless and not made by its authors. It reads the
state portless keeps in `~/.portless` and names routes through the `portless` command, so anything
you or an agent do with portless shows up in Studio, and Studio never changes how portless works.

## Security

Studio only listens on `127.0.0.1` and rejects requests whose `Host` or `Origin` is not local, so
other websites open in your browser cannot read your routes or call the API. Every change also
needs a token that changes on every run and that only Studio's own page can read. A dev server can
be stopped only when it belongs to your user, and Studio never runs a command that needs sudo.
See [SECURITY.md](SECURITY.md) to report a problem.

## Development

```bash
git clone https://github.com/keven-bardales/portless-studio
cd portless-studio
pnpm install
pnpm dev          # API on :4949 and the web app with hot reload on :5173
pnpm test         # unit and component tests
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the checks to run and pull requests,
[docs/architecture.md](docs/architecture.md) the layers and
[docs/conventions.md](docs/conventions.md) the code conventions.

## License

MIT, see [LICENSE](LICENSE).
