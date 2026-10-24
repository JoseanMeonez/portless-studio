# portless studio

A local web dashboard for [portless](https://github.com/vercel-labs/portless). See every app and
alias portless is routing, open them, copy their URLs, and give a name to any port, from one page
in your browser.

![portless studio showing six routes](docs/screenshot.jpg)

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

It starts on `http://127.0.0.1:4321`, registers itself in portless as `studio`, so it is also at
`https://studio.localhost`, and opens your browser.

| Flag | Effect |
| --- | --- |
| `--port <n>` | Listen on another port. Default 4321. |
| `--no-open` | Do not open the browser. |
| `--no-register` | Do not register the `studio` name in portless. |

Want to see it without portless? Open `http://127.0.0.1:4321/?demo` for sample data, or
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
pnpm dev          # API on :4321 and the web app with hot reload on :5173
pnpm test         # unit and component tests
pnpm typecheck
pnpm check        # lint and format check
```

The code is split so the web app can talk to another backend later: see
[docs/architecture.md](docs/architecture.md). Conventions are in
[docs/conventions.md](docs/conventions.md).

## License

MIT
