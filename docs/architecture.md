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
| `src/server/infrastructure` | Adapters that implement ports. Today only `portless`: reads the state directory, watches it, shells out to the CLI for writes, detects the binary with `portless --version` and installs it with `npm install -g portless`. | `core`, `application` |
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
| `PortScanner` (`application/port-scanner.ts`) | `infrastructure/system`: `/proc` on Linux, `lsof` on macOS, `netstat` and `tasklist` on Windows | Lists listening ports with their process and folder, and probes whether a port answers HTTP. |
| `ConfigStore` (`application/config-store.ts`) | `infrastructure/config/json-config-store.ts` | Reads, writes and watches the JSON config file. |

`StudioRuntime` (`application/studio-runtime.ts`) ties them together. It scans every
`scanIntervalMs` while a browser is watching or auto mode is on, builds the full `Snapshot`
(portless state plus detected ports), and, in auto mode, names each new dev server through
`RouteRegistry.createAlias`. A detected port must answer HTTP, have no route, not be ignored, not be
another Studio (they send `x-portless-studio`), and run on a known runtime (`node`, `python`, `bun`
and similar) or from a binary built inside the project.

`StudioRuntime` also adds two optional fields to each route in the snapshot: `listenerPid`, the
process listening on the route's port in the last scan, and `health`, the last HTTP probe of that
port (`up` below 500, `error` for 5xx, `down` when nothing answers). Routes are probed on the scan
loop only while a browser watches.

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
`controlStudio(action)` and `stopProcess(pid)`.

## Security

The server listens on `127.0.0.1` only. Every request must carry a `Host` that is loopback or a
`.localhost` name, and a browser `Origin`, when present, must match it. Writes, including the
portless install, also need a per-run token the page reads from `GET /api/session`; browsers only let same-origin pages read it. This keeps other websites
open in the same browser from creating or removing routes, controlling the proxy or Studio, or
stopping processes.
