# Architecture

Portless Studio is a web dashboard for [portless](https://github.com/vercel-labs/portless). It runs a
small Node server on your machine that reads portless state and serves a React app. You open it in
any browser.

```text
 Browser (React app)                         Node server (zero dependencies)
 ┌──────────────────────────┐   HTTP + SSE   ┌──────────────────────────────┐
 │ features/routes          │ ─────────────> │ interface/http               │
 │   RoutesGateway (port)   │   /api/...     │   router, security, events   │
 │   HttpRoutesGateway      │                │ application                  │
 └──────────────────────────┘                │   RouteRegistry (port)       │
                                             │ infrastructure/portless      │
                                             │   reads ~/.portless,         │
                                             │   runs `portless alias`      │
                                             └──────────────────────────────┘
```

## Folders

The top level says what the project is about; each folder below it says what it does.

| Folder | What lives there | May import |
| --- | --- | --- |
| `src/core` | Domain types and rules shared by both sides: what a route is, how a name is validated, the HTTP API contract. No IO, no React, no Node APIs. | nothing outside `core` |
| `src/server/application` | Use cases (list routes, name a port, remove an alias, install portless) and the `RouteRegistry` port they depend on. | `core` |
| `src/server/infrastructure` | Adapters that implement ports: `portless` reads the state directory, watches it, shells out to the CLI for writes, detects the binary with `portless --version` and installs it with `npm install -g portless`; `system` scans ports and reads processes; `config` keeps Studio's files; `apps` finds and starts editors for the open-with menu; `terminal` starts terminal commands. | `core`, `application` |
| `src/server/interface/http` | The HTTP server: routing, request guards, JSON and server-sent events, static files. | `core`, `application` |
| `src/server/main.ts` | Composition root: builds the adapters and wires them into the HTTP server. | everything in `server` |
| `src/cli` | The `portless-studio` command: parses flags, starts the server, opens the browser. | `server` |
| `src/web/app` | Composition root of the React app: picks the gateway, mounts providers and the layout. | everything in `web` |
| `src/web/features/<feature>` | One folder per product feature. See below. | `core`, `web/shared` |
| `src/web/shared/ui` | The design system: buttons, inputs, dialogs, command menu. Knows nothing about routes. | `web/shared` |
| `src/web/shared/lib` | Small framework-free helpers: formatting, clipboard, keyboard. | nothing outside `shared` |
| `src/web/styles` | Design tokens and global styles. | |

## Inside a web feature

```text
features/routes/
  data/          RoutesGateway (the port) and HttpRoutesGateway (the adapter)
  hooks/         state and behavior: useRoutes, useRouteActions
  components/    presentational components, props in, JSX out
  containers/    connect hooks to components; the only place both meet
  index.ts       what the rest of the app may import from this feature
```

## Replacing the backend

The browser never talks to portless or to `fetch` directly. It talks to `RoutesGateway`, an
interface in `features/routes/data/routes-gateway.ts`. `HttpRoutesGateway` implements it against
the API described in `src/core/api/contract.ts`.

To move to a different backend, write another class that implements `RoutesGateway` and pass it in
`src/web/app/app.tsx`. Nothing in `hooks`, `components` or `containers` changes.

The server has the same seam: use cases depend on the `RouteRegistry` port, and the portless
adapter is one implementation of it. The port has these methods:

| Method | What it does |
| --- | --- |
| `readSnapshot()` | Routes, proxy status and whether portless is installed (with its version). |
| `watch(onChange)` | Calls `onChange` when any of that changes. |
| `createAlias(name, port, force)` | Names a port. |
| `removeAlias(name)` | Removes a name. |
| `installPortless()` | Runs `npm install -g portless`, then detects portless again and notifies watchers. Fails with `install_failed` (HTTP 502, npm's output in the message) or `install_in_progress` (HTTP 409) while another install runs. |
| `startProxy(port, https)` / `stopProxy()` | `portless proxy start` and `portless proxy stop`, with stdin closed so nothing waits for a password. |
| `proxyPid()` | The pid portless recorded in `proxy.pid`, so Studio can tell whether root owns the proxy. |

The portless adapter caches the `portless --version` result for 30 seconds, so reads and polling
do not start a process each time; an install clears the cache.

Two more ports feed port detection and settings:

| Port | Default implementation | What it does |
| --- | --- | --- |
| `PortScanner` (`application/port-scanner.ts`) | `infrastructure/system`: `/proc` on Linux, `lsof` on macOS, `netstat` plus one PowerShell `Win32_Process` query (cached 30 s) on Windows | Lists listening ports with their process, executable and folder (on Windows the folder comes from the script path in the command line), and probes whether a port answers HTTP. See `docs/platforms.md`. |
| `ConfigStore` (`application/config-store.ts`) | `infrastructure/config/json-config-store.ts` | Reads, writes and watches the JSON config file. |

`StudioRuntime` (`application/studio-runtime.ts`) ties them together. It scans every
`scanIntervalMs` while a browser is watching or auto mode is on, builds the full `Snapshot`
(portless state plus detected ports), and, in auto mode, names each new dev server through
`RouteRegistry.createAlias`. A detected port must answer HTTP, have no route, not be ignored, not be
another Studio (they send `x-portless-studio`), not belong to a portless proxy, and run on a known
runtime (`node`, `python`, `bun` and similar) or from a binary built inside the project. A port is
the proxy's when portless recorded it in `proxy.port`, or when the process listening on it runs
`portless proxy start` (`proxyPidsAmong` in `infrastructure/system/doctor-facts.ts` reads the
command line of just the listening pids: `/proc` on Linux, `ps -p` on macOS; Windows relies on
`proxy.port` only).

### Suggested names

`suggestName` (`core/ports/detected-port.ts`) builds `<package>.<repo>` from the folder, and puts
in front of it what the work is, so two worktrees of one repository get different names. It reads
the branch from `.git/HEAD`, or from the `HEAD` in the gitdir a linked worktree's `.git` file points
at, without starting `git`. A ticket key in the branch wins (`feat/ED-1234-add-x` gives
`ed-1234.web.acme`), else the branch's last segment (`feat/dark-mode` gives `dark-mode.web.acme`),
and the repository drops a `-monorepo` or `-repo` suffix. On `main`, `master`, `develop` or a
detached HEAD, a linked worktree's folder is the prefix instead (`falcon.web.acme-monorepo`).
`ProjectInfoReader` caches the folder walk but reads the branch on every scan.

### Names auto mode gives back

Auto mode records each name it gives in `auto-named.json`, next to the config file, as
`{ "autoNamed": [{ "name", "port", "createdAt" }] }` (port `AutoNamedStore`,
`infrastructure/config/json-auto-named-store.ts`). It is a separate file because Studio writes it
on its own and nobody needs to edit it. On every scan, a recorded name whose port is closed starts
a clock; once the port has been closed for `autoRemoveAfterMinutes` (default 10, `0` keeps names
forever) Studio removes the alias through `RouteRegistry.removeAlias` and logs it. The clock lives
in memory, so a Studio restart starts it again. A recorded name that no longer points at its port,
or is gone, belongs to someone else now: it is dropped from the list, never removed. Names a person
or an agent gave are never in the list. When the same project comes back on another port while its
old name is still waiting, auto mode moves that name to the new port instead of adding `-<port>`.

`StudioRuntime` also adds three optional fields to each route in the snapshot: `listenerPid`, the
process listening on the route's port in the last scan; `project`, the repository (and linked git
worktree) that process runs in, read with `ProjectInfoSource` from its folder; and `health`, the
last HTTP probe of that port (`up` below 500, `error` for 5xx, `down` when nothing answers).
Detected ports carry `project` too. Routes are probed on the scan loop only while a browser
watches.

## Where each row runs

Each route and detected port carries `project.branch` and `project.path` next to `name` and
`worktree` (`ItemProject`, `core/routes/route.ts`), built by `itemProjectAt`
(`core/projects/item-project.ts`) from what `ProjectInfoSource` reads. `path` is the git root, else
the package folder, else the process folder. The row shows the branch, the worktree and the path
shortened with `~`.

A route whose port has no readable process keeps the last project seen for its name. `StudioRuntime`
keeps those in memory and in `route-projects.json` next to the config, as
`{ "routeProjects": { "<route name>": ItemProject } }` (port `RouteProjectStore`, adapter
`infrastructure/apps/json-stores.ts`), so they survive a restart. Entries of routes that no longer
exist are dropped.

## Open with

Right-click, Ctrl+click (Cmd+click on macOS), `.` or `Shift+F10` on a row opens a menu with Open in
browser, Copy URL, Copy path, Reveal in the file manager and an Open with submenu.
`application/open-with.ts` holds the use case and three ports:

| Port | Default implementation | What it does |
| --- | --- | --- |
| `AppCatalog` | `infrastructure/apps/app-catalog.ts` | Finds VS Code, VS Code Insiders, Cursor, Zed, WebStorm, IntelliJ IDEA and Sublime Text without starting them: their command on PATH (with `PATHEXT` on Windows), app bundles in `/Applications` and `~/Applications` opened with `open -a` on macOS, and the usual install folders under `%LOCALAPPDATA%` and `%ProgramFiles%` on Windows. The file manager is `xdg-open` on Linux, `open -R` (Finder) on macOS and `explorer /select,"<path>"` on Windows. |
| `AppLauncher` | `infrastructure/apps/detached-launcher.ts` | Starts the program detached with an argument list and no shell. Windows `.cmd` shims go through `cmd.exe /d /s /c` with every word quoted, and a folder containing `"` or `%` is refused there. |
| `CustomAppStore` | `infrastructure/apps/json-stores.ts` | The apps added in Settings, in `open-with.json` next to the config. |

Custom apps live in their own file, not in the config, so the config schema and its validation
stay as they are; the page saves them with their own button. A custom command is split into words
by `splitCommand` (`core/projects/custom-app.ts`): spaces separate, quotes group, nothing else is
special, and `{path}` is replaced inside a word after splitting, so a folder with spaces or shell
characters stays one argument.

`POST /api/open-with` takes `{ appId, path }` and needs the token. `path` must be exactly one of
`StudioRuntime.openableFolders()`: the project folder of a route (current or remembered) or of a
detected port, or a detected port's folder. Anything else answers `path_not_allowed` (403), and an
unknown app `unknown_app` (404). `GET /api/open-with/apps` lists the apps, and
`GET`/`PUT /api/open-with/custom-apps` reads and replaces the custom ones.

## Project icons

`application/icon-resolver.ts` picks each route's and detected port's `icon`, in this order: the
project's entry in `projectIcons` from the config; the favicon the server on that port serves; a
favicon in the project folder. With none, the page draws the project's initials on a color made
from its name (`web/shared/lib/monogram.ts`). The snapshot also carries `projectIcons`, one icon
per project name, for group headers.

The `IconFetcher` port has a default implementation in
`infrastructure/system/favicon-fetcher.ts`. It asks `127.0.0.1:<port>` for `/favicon.ico`, then
reads the `<link rel="icon">` of `/` and follows it only on the same server; it reads
`public/favicon.*`, `app/icon.*`, `src/app/icon.*` and `static/favicon.*` from the folder; and it
downloads http(s) URLs set in the config. Every answer must be an image of 64 KB or less and is
returned as a `data:` URL, because the page's Content-Security-Policy only allows `data:` images:
the browser never loads an icon from another origin. Fetches run in the background, once per URL
and per port and pid; when one finds an icon, watchers get a new snapshot.

## Views and shortcuts

Saved views, the default view and favorites are fields of the Studio config (`views`,
`defaultViewId`, `favorites`), validated by `parseConfig` like every other field, so they are
edited in the JSON file or from the page and written through the same `PUT /api/config`. A view
is grouping, sort and filters (`core/views/view.ts`); `core/views/arrange-routes.ts` applies one
to the routes with a pure function. The page keeps the view id, the search and any unsaved
grouping, sort or filter change in the URL query (`?view=…&q=…&kind=…&sort=…`), and closed groups
and the last selected row in `localStorage`.

Every keyboard shortcut is declared once in `features/routes/hooks/shortcut-registry.ts`. The
keyboard hook dispatches from it, the command menu shows its keys and the `?` dialog lists it, so
the three cannot drift apart.

## Notifications

`application/studio-events.ts` compares what Studio saw last with what it sees now
(`eventsBetween`, a pure function) and turns the difference into `StudioEvent`s
(`core/api/contract.ts`): `detected` (a new dev server), `named` (a route appeared or was
renamed), `removed`, `down` and `up` (route health), and `proxy` (started or stopped). Each has a
title, a body and a target, a route name or a port. `EventLog` keeps the last 50 in memory.

The events stream (`GET /api/events`) carries them as `event` messages next to the `snapshot`
ones, and replays the recent ones to every page that connects. An event is written after the
snapshot that shows its change, so the item it points at is already in the list.

The page shows each new event as a toast with a Show button, and lists the recent ones under the
bell in the header with an unread count (what was read is kept in `localStorage`). Show clears the
search and filters that hide the item, opens its group, selects it and scrolls to it. Events
older than the page get no toast. With `desktopNotifications` on, the browser has granted
permission and the tab is in the background, the page also shows a browser notification whose
click focuses the tab and shows the item. This needs a Studio tab open.

With `systemNotifications` on and no tab watching, Studio asks the operating system to show
`named` and `down` events (`SystemNotifier`, `infrastructure/system/os-notifier.ts`), and keeps
probing route health so `down` can happen. The command runs through `execute` and the server
never waits for it:

| System | Command | Click |
| --- | --- | --- |
| Linux | `notify-send --app-name="portless studio" --action=open=Open` | Opens Studio with `xdg-open`. Older `notify-send` without `--action` shows the notification only. Without `notify-send`, nothing is shown and the doctor says so. |
| macOS | `osascript -e 'display notification ...'` | None: AppleScript notifications cannot react to a click. |
| Windows | A PowerShell toast through `Windows.UI.Notifications`, sent as `-EncodedCommand` | Opens Studio through protocol activation. Best effort: it needs Windows PowerShell 5. |

The link a click opens is Studio's own route when it has one, otherwise `http://localhost:<port>`,
with `?focus=<route name>` or `?focus=port:<number>`; the page shows that item and drops the
parameter.

## Health checks and control

Three more ports serve the Health panel, `portless-studio doctor` and the service controls:

| Port | Default implementation | What it does |
| --- | --- | --- |
| `ProcessControl` (`application/process-control.ts`) | `infrastructure/system/system-process-control.ts` | Says who owns a pid (root, you, another user) from `/proc/<pid>/status`, `ps` or `tasklist`, and stops a process with SIGTERM, then SIGKILL after 5 seconds (`taskkill` on Windows). |
| `StudioServiceControl` (`application/studio-service.ts`) | `cli/studio-service-control.ts` | Restarts or stops Studio through systemd or launchd when it runs as the login service; otherwise a stop exits the process. The CLI provides it because only the CLI knows how Studio was started. |
| `ProbePort` (`application/port-scanner.ts`) | `probeHttpResponse` in `infrastructure/system/system-port-scanner.ts` | One `HEAD /` to a loopback port: status, latency, and whether a Studio answered. |

The doctor is split in two. `infrastructure/system/doctor-facts.ts` gathers facts without changing
anything: the portless proxy processes and their owners, Chrome's certificate store on Linux
(`certutil -L -d sql:$HOME/.pki/nssdb`), what holds Studio's port, the config and the login
service. `application/doctor.ts` turns those facts into `DoctorCheck`s (`core/doctor`) with a pure
function, so every rule is tested with plain objects. A fix runs only when the check offers it as an
action at that moment (start the proxy, restart a proxy you own, move to HTTP on port 1355); fixes
that need sudo are commands to copy, never run.

`application/proxy-control.ts` starts, stops and restarts the proxy, and refuses with
`needs_admin` and the `sudo` command when root or another user owns it.
`application/stop-process.ts` stops a dev server only when its pid listens on a detected or routed
port and belongs to the current user.

On the web side, `RoutesGateway` also has `getConfig()`, `updateConfig(config)`,
`ignoreDetected(port)`, `getDoctor()`, `runDoctorFix(id)`, `controlProxy(action)`,
`controlStudio(action)`, `stopProcess(pid)`, `listOpenWithApps()`, `openWith(request)`,
`getCustomApps()` and `updateCustomApps(apps)`.

## Terminals

Studio runs commands in terminals the page, the CLI (`portless-studio run`) and agents (the MCP
tools) share; docs/terminals.md covers what people see. `application/terminals.ts` holds
`TerminalManager` and the ports it needs:

| Port | Default implementation | What it does |
| --- | --- | --- |
| `TerminalSpawner` | `infrastructure/terminal/terminal-spawner.ts` | Starts a command in a pseudo-terminal through the system `script` command (util-linux on Linux, BSD on macOS), or with pipes and `FORCE_COLOR=1` on Windows and where `script` is missing. `detectTerminalMode` runs `script -V` once, on the first terminal. Stops go to the command's process group; on Windows `stopProcessTree` in `infrastructure/system/process-runner.ts` stops the tree. |
| `TerminalFolders` | `nodeTerminalFolders` in the same file | Whether a folder exists, and whether one folder is inside another (case-insensitive on Windows). |
| `TerminalWorkspace` | built in `main.ts` from `StudioRuntime` and the route use cases | The folders Studio shows, the current routes and detected ports, and naming the port a `run` command opens. |

Each terminal keeps its output in an `OutputBuffer` (`core/terminals/output-buffer.ts`): the
newest 2 MB, every character numbered, so a client resumes with `?from=<n>`. `plainText`
(`core/terminals/terminal.ts`) strips escape codes for agents and the clipboard.

When a terminal is asked to name its port, the manager remembers the ports in use at start and
watches the runtime (which keeps it scanning) until a new detected port appears whose folder is
inside the terminal's, then names it through the same `createAlias` the page uses. If auto mode
names it first, the manager adopts that route, or renames it when a name was asked for. It gives
up when the command ends or after 3 minutes.

The HTTP endpoints are in `API_PATHS` (`core/api/contract.ts`); `interface/http/terminal-streams.ts`
serves the two event streams (the list of terminals, and one terminal's output). Every terminal
endpoint needs the token, reads included, and accepts it as `?token=` for EventSource. A request
with no `Origin` and no `Sec-Fetch-Site` header comes from a local program, which may run in any
existing folder; a page may run only in folders Studio shows (`StudioRuntime.openableFolders()`)
or one a local program already used.

On the web side, `features/terminals` has its own port, `TerminalsGateway`, with an HTTP and an
in-memory version, the panel and the xterm.js view. xterm.js is loaded with a dynamic `import()`
in `hooks/xterm-loader.ts`, so it lands in its own chunk. The routes feature does not import the
terminals feature: `RoutesDashboard` takes a `TerminalLauncher` (open a terminal in a folder, show
one by id) and a function that draws the panel, and `app/studio-layout.tsx` connects the two.

## Bringing Studio to the front

`POST /api/focus` (`portless-studio open`, MCP `focus_studio`) resolves the target with
`resolveFocusTarget` (`interface/http/focus-broker.ts`): a terminal id, a route name, `port:<n>`,
or a project name. `FocusBroker` sends a `focus` event (`FocusEvent`) on `/api/events` to every
open page; each page shows the target, calls `window.focus()` and answers on `/api/focus/ack`
whether it has the focus. When no page is open, or none says yes within 1.5 seconds, Studio opens
the page link with the browser opener the CLI passes in (`openUrl`), built by
`StudioRuntime.pageUrl()`. Pages also read `?terminal=<id>` on load, next to `?focus=`.

## Uninstall

`portless-studio uninstall` (`cli/uninstall.ts`) lists what it will undo and asks once: remove
the login service, the names in `auto-named.json` that still point at their port, and the
`studio` alias, then stop the proxy. It stops the proxy only when its pid matches
`proxy-started.json` and it runs as the current user. That file sits next to the config, and
`recordProxyStarts` (`infrastructure/config/proxy-start-record.ts`) writes it each time Studio
starts the proxy, at launch, in `init` or from the page. Deleting the settings is a separate
question that defaults to no; it removes only the files Studio writes, and the folder once it is
empty.

## Security

The server listens on `127.0.0.1` only. Every request must carry a `Host` that is loopback or a
`.localhost` name, and a browser `Origin`, when present, must match it. Writes, including the
portless install, also need a per-run token the page reads from `GET /api/session`; browsers only let same-origin pages read it. Terminal endpoints need it for reads
too. This keeps other websites open in the same browser from creating or removing routes,
controlling the proxy or Studio, stopping processes, or running commands and reading their
output.
