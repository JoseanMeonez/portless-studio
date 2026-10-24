# portless studio

A local web dashboard for [portless](https://github.com/vercel-labs/portless). See every app and
alias portless is routing, open them, copy their URLs, and give a name to any port, from one page
in your browser.


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
- Starts the portless proxy on port 1355 over HTTP, which needs no password, certificate or extra
  tool on macOS, Windows or Linux, and can set Studio to start when you log in.

Your apps then open at names like `http://web.myapp.localhost:1355`. Chrome, Edge and Firefox send
every `*.localhost` name to your own machine by themselves, with no hosts file and no DNS setup.

`init --yes` accepts every default without asking.

### Commands

| Command | What it does |
| --- | --- |
| `portless-studio` | Starts Studio with the settings from the config file. |
| `portless-studio init [--yes]` | The setup above. Safe to run again. |
| `portless-studio uninstall [--yes]` | Undoes the setup: stops and removes the login service, removes the names auto mode gave and the `studio` name, and stops the proxy if Studio started it as you. Names you or an agent gave stay. Asks separately before deleting the settings folder (default no). |
| `portless-studio service install` | Starts Studio when you log in: a systemd user unit on Linux, a LaunchAgent on macOS, a script in the Startup folder on Windows. |
| `portless-studio service uninstall` | Undoes `service install`. |
| `portless-studio service status` | Says whether the login service is installed and running. |
| `portless-studio config [--edit]` | Prints the config file path and its contents, or opens it in `$EDITOR`. |
| `portless-studio doctor` | Checks portless, the proxy, the certificate, Studio's port and the login service, and prints the fix for each problem. Exits with 1 when something fails. |

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
| `startProxy` | `true` | Starts the portless proxy when Studio starts and it is not running. |
| `proxyPort` | `1355` | Port of that proxy. 1355 needs no administrator rights anywhere; 443 removes the port from URLs but needs sudo once. |
| `proxyHttps` | `false` | Serves the names over HTTPS. Browsers only trust the local certificate after extra system setup, so HTTP is the default. |
| `scanIntervalMs` | `3000` | How often Studio looks for new listening ports, in milliseconds (at least 1000). |
| `ignoredPorts` | `[]` | Ports never shown as detected and never named automatically. |
| `ignoredProcesses` | `["code", "cursor", "discord", "slack", "spotify", "chrome", "firefox"]` | Process names whose ports are never shown. |
| `views` | one view, `All`, grouped by project | Saved views. Each has an `id`, a `name`, `groupBy` (`none`, `project`, `worktree`, `kind`, `status` or `custom`), `sort` (`by`: `name`, `port`, `newest` or `status`; `direction`: `asc` or `desc`), `filters` (`kinds`, `projects`, `statuses`) and, for custom grouping, `customGroups` (`id`, `name`, `members`). |
| `defaultViewId` | `"all"` | The view the page opens with. |
| `favorites` | `[]` | Routes pinned above every group, by name or as `"port:3000"`. |
| `nameTemplate` | `"{work}.{package}.{repo}"` | How suggested names are built. See [Naming](#naming). |
| `projectIcons` | `{}` | Icon per project name, e.g. `{ "acme": "🦊" }`: an emoji, an http(s) image URL (Studio downloads it and inlines it) or a `data:image` URL. |

The `--port`, `--no-open` and `--no-register` flags win over the file for one run.

Apps you add to the Open with menu live in `open-with.json` next to the config file, as
`{ "customApps": [{ "name": "Neovim", "command": "kitty --directory {path} nvim" }] }`.
`{path}` is the project folder; without it the folder goes last. Studio runs the command
directly, not through a shell.

portless replaces port numbers with names: `portless api pnpm dev` serves your app at
`https://api.localhost`. It has no interface of its own, so when you run ten dev servers across
several projects you have to remember which names exist. portless studio shows them live.

## What it does

- **Live list** of portless routes: name, URL, port, whether it is an app or an alias, uptime and
  any Tailscale, ngrok or Cloudflare tunnel. It updates as soon as a route appears or goes away.
- **Name a port:** give a name to something portless did not start, such as a database in
  Docker (`db` -> `https://db.localhost`). Rename or remove those names later.
- **Views:** group the list by project, git worktree, kind or status, or into groups you make
  yourself ("Move to group…" on a row). Sort by name, port, newest or status, and filter with the
  chips for kind, status and project. Save any combination as a named view, switch views with
  `v` and pick the one that opens by default. Views and favorites live in the config file.
- **Names that say what the work is:** a suggested name starts with the ticket key in the git
  branch (`feat/ED-1234-add-x` gives `ed-1234.web.acme`) or the branch name, so two worktrees of
  one repository are told apart.
- **Project icons:** each row and project group shows the favicon its server serves, else a
  favicon in the project folder (`public/favicon.svg`, `app/icon.png`, `static/favicon.ico`), else
  the project's initials. Set an emoji or an image per project in Settings.
- **Where each server runs:** every row shows its git branch, the linked worktree and the project
  folder (shortened with `~`, the full path on hover). A route whose server is down keeps the last
  place it ran, also after Studio restarts.
- **Open with:** right-click a row, Ctrl+click (Cmd+click) it, or press `.` or `Shift+F10` on the
  selected one to open its folder in an editor found on this machine (VS Code, Cursor, Zed,
  WebStorm, IntelliJ IDEA, Sublime Text), reveal it in the file manager, copy its path or URL, or
  open it in the browser. Add your own apps in Settings.
- **Favorites:** the star on a row, or `f`, pins it above every group in every view.
- **Remembered state:** the view, search, filters and sort sit in the page URL, so a reload, a
  bookmark or the Back button keeps them. Closed groups and the selected row are remembered in
  the browser.
- **Keyboard first:** every action has a key, `?` lists them all and `Ctrl+K` (or `Cmd+K`) runs
  any of them by name.
- **Proxy status and control:** shows whether the portless proxy is running, on which port and
  TLD. Click it to start, stop or restart the proxy. A proxy started with sudo cannot be stopped
  from the page; Studio shows the `sudo` command to run instead.
- **Health panel:** the header's Health button turns amber or red when something needs attention,
  such as a proxy left running as root, two proxies at once, an HTTPS certificate Chrome does not
  trust, or another program on Studio's port. Each problem comes with a button that fixes it, or
  the command to copy when it needs sudo. The same checks run in `portless-studio doctor`.
- **Route health:** each route's dot is green when its port answers, amber when it answers with a
  server error and red when an app stops answering; the tooltip says `200 in 12 ms`.
- **Stop a dev server** from its row, after a confirmation that names the process and port. Only
  your own processes that listen on a port Studio shows can be stopped.
- **Restart or stop Studio** from the Health panel. As a login service, systemd or launchd do it;
  started from a terminal, Studio can only stop.
- **Install portless:** when the portless command is missing, the page says so and can run
  `npm install -g portless` for you, showing npm's output.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `j` / `↓`, `k` / `↑` | Next and previous row, across groups |
| `Home`, `End` | First and last row |
| `/` | Search routes |
| `Enter` or `o` | Open the selected route |
| `c` | Copy its URL |
| `r` | Rename an alias |
| `Delete` | Remove an alias |
| `f` | Pin or unpin as favorite |
| `.` or `Shift+F10` | Open with, copy path and more |
| `n` | Name a port |
| `v` | Next view |
| `Shift+V` | Open the view menu |
| `Ctrl+K` / `Cmd+K` | Command menu |
| `,` | Settings |
| `?` | All keyboard shortcuts |
| `Esc` | Close a dialog or cancel |

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

## Naming

A suggested name says what the work is, then the app, then the repository: the package `@acme/web`
in `acme-monorepo` on the branch `feat/ED-1234-add-x` gets `ed-1234.web.acme`. That is the order
portless uses for worktrees, `<branch>.<name>.localhost`. Change it with `nameTemplate` in the
config file or in Settings, for example `{ticket}.{repo}` or `{package}-{port}`.
[docs/naming.md](docs/naming.md) lists every token and how empty or repeated labels are dropped.

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
names, installing portless, controlling the proxy or Studio and stopping a dev server also need a
token that changes on every run. The install always runs the same fixed command; nothing from the
request reaches it. A dev server can be stopped only when it belongs to your user and listens on a
port Studio shows, and Studio never runs a command that needs sudo.

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
