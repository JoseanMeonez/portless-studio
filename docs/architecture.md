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
| `src/server/application` | Use cases (list routes, name a port, remove an alias) and the `RouteRegistry` port they depend on. | `core` |
| `src/server/infrastructure` | Adapters that implement ports. Today only `portless`: reads the state directory, watches it, shells out to the CLI for writes. | `core`, `application` |
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
adapter is one implementation of it.

## Security

The server listens on `127.0.0.1` only. Every request must carry a `Host` that is loopback or a
`.localhost` name, and a browser `Origin`, when present, must match it. Writes also need a
per-run token the page reads from `GET /api/session`; browsers only let same-origin pages read it. This keeps other websites
open in the same browser from creating or removing routes.
