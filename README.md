# portless studio

A local web dashboard for [portless](https://github.com/vercel-labs/portless). See every app and
alias portless is routing, open them, copy their URLs, and give a name to any port, from one page
in your browser.

![portless studio showing six routes](docs/screenshot.jpg)

## Quick start

```bash
npx portless-studio init
```

Until the package is published, run it from a clone: `pnpm install && pnpm build && node
dist/cli/index.js init`.

`init` asks a few questions and leaves everything working:

- Checks that portless is installed and offers to install it with npm.
- Asks for the basic settings (auto mode, start at login, port, open the browser) and saves them.
- Finds the dev servers already running, suggests a name for each and names them in portless.
- Starts the portless proxy, which asks for your password once, and can set Studio to start
  when you log in.

`init --yes` accepts every default without asking.

### Commands

| Command | What it does |
| --- | --- |
| `portless-studio` | Starts Studio with the settings from the config file. |
| `portless-studio init [--yes]` | The setup above. Safe to run again. |
| `portless-studio service install` | Starts Studio when you log in: a systemd user unit on Linux, a LaunchAgent on macOS, a script in the Startup folder on Windows. |
| `portless-studio service uninstall` | Undoes `service install`. |
| `portless-studio service status` | Says whether the login service is installed and running. |
| `portless-studio config [--edit]` | Prints the config file path and its contents, or opens it in `$EDITOR`. |

### Config file

Settings live in one JSON file. `portless-studio config` prints where it is; you can edit it by
hand or from the settings panel in the page, and a running Studio picks up the changes without a
restart. Missing fields take their default.

| Field | Default | What it does |
| --- | --- | --- |
| `port` | `4949` | Port Studio listens on, on 127.0.0.1. |
| `autoName` | `false` | Gives every new dev server a portless name automatically. |
| `openBrowser` | `true` | Opens the browser when Studio starts. |
| `registerStudioAlias` | `true` | Registers Studio itself in portless as `studio`. |
| `scanIntervalMs` | `3000` | How often Studio looks for new listening ports, in milliseconds (at least 1000). |
| `ignoredPorts` | `[]` | Ports never shown as detected and never named automatically. |
| `ignoredProcesses` | `["code", "cursor", "discord", "slack", "spotify", "chrome", "firefox"]` | Process names whose ports are never shown. |

The `--port`, `--no-open` and `--no-register` flags win over the file for one run.

portless replaces port numbers with names: `portless api pnpm dev` serves your app at
`https://api.localhost`. It has no interface of its own, so when you run ten dev servers across
several projects you have to remember which names exist. portless studio shows them live.

## What it does

- **Live list** of portless routes: name, URL, port, whether it is an app or an alias, uptime and
  any Tailscale, ngrok or Cloudflare tunnel. It updates as soon as a route appears or goes away.
- **Name a port:** give a name to something portless did not start, such as a database in
  Docker (`db` -> `https://db.localhost`). Rename or remove those names later.
- **Keyboard first:** `j`/`k` to move, `Enter` to open, `c` to copy, `n` to name a port,
  `/` to filter and `Ctrl+K` (or `Cmd+K`) for the command menu.
- **Proxy status:** shows whether the portless proxy is running, on which port and TLD.
- **Install portless:** when the portless command is missing, the page says so and can run
  `npm install -g portless` for you, showing npm's output.

## Run it

Requires Node 24. portless should be on your `PATH`; if it is not, the page offers to install it
with `npm install -g portless`, or shows the command so you can run it yourself.

```bash
git clone https://github.com/dev/portless-studio
cd portless-studio
pnpm install
pnpm build
pnpm start
```

It starts on `http://127.0.0.1:4949`, registers itself in portless as `studio`, so it is also at
`https://studio.localhost`, and opens your browser.

| Flag | Effect |
| --- | --- |
| `--port <n>` | Listen on another port. Default: `port` in the config, 4949. |
| `--no-open` | Do not open the browser. |
| `--no-register` | Do not register the `studio` name in portless. |

Want to see it without portless? Open `http://127.0.0.1:4949/?demo` for sample data, or
`?demo&noportless` to try the install flow with a fake install.

## Naming routes from agents and scripts

portless studio reads what portless already knows, so anything that names a route through the
portless CLI shows up here. Tell your coding agents to start dev servers like this:

```bash
portless web.myapp pnpm dev       # a dev server, at https://web.myapp.localhost
portless alias db.myapp 5432      # a port something else opened, at https://db.myapp.localhost
```

## Security

The server listens on `127.0.0.1` only and rejects requests whose `Host` or `Origin` is not local,
so other websites open in your browser cannot read your routes. Creating, renaming and removing
names, and installing portless, also need a token that changes on every run. The install always
runs the same fixed command; nothing from the request reaches it.

## Develop

```bash
pnpm dev          # API on :4949 and the web app with hot reload on :5173
pnpm test         # unit and component tests
pnpm typecheck
pnpm check        # lint and format check
```

The code is split so the web app can talk to another backend later: see
[docs/architecture.md](docs/architecture.md). Conventions are in
[docs/conventions.md](docs/conventions.md).

## License

MIT
