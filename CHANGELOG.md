# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## Unreleased

- Helper ports stay out of the way. A named server's other ports (opened by the same process), Node, V8 and Chrome debuggers (found by their `/json/version` answer, and
  9229 or 9222 when that is unclear) and ports in the system's ephemeral range no longer show as
  separate Detected rows suggesting the same name. They are listed under a closed "Other ports
  (N)" at the bottom of Detected, each with its process, direct URL and reason, in the snapshot as
  `otherPorts`; auto mode never names them. `showEphemeralPorts` (Settings, "Show temporary
  ports") lists ephemeral ports with the others again. One process on several ports is one row,
  with the extra ports listed as "Also answers on". The Detected section folds down to its title,
  and the page remembers that and whether Other ports is open.

- `.env` lines from route names: `portless-studio env [--prefix P] [--strip S] [--direct] [--json]
  [name...]` prints `API_ACME_URL=http://api.acme.localhost:1355` for each route, so an app can
  call another by a URL that survives port changes. A name also picks its `*.name` routes,
  `--strip acme` turns `api.acme` into `API_URL`, `--prefix VITE_` adds a prefix and `--direct`
  uses `http://localhost:<port>`. In the page, the row menu has Copy as .env line and the command
  menu has Copy routes as .env and Choose routes for .env…, a dialog with route checkboxes, prefix,
  suffix and a live preview. The MCP tool `env_lines` returns the same lines and writes no file.

## 0.1.2 (2026-10-25)

- Docker containers show under Detected: Studio reads `docker ps` once per scan (2-second limit,
  silently skipped when Docker is missing, stopped or refuses the user) and lists each published
  port that answers HTTP, with a Docker badge, the image and a suggested name from the compose
  service and project (`api.acme`) or the container name. Stop runs `docker stop` after a
  confirmation, only for containers `docker ps` listed. The doctor says whether it reads containers.
- Short URLs: with `shortUrls: true` (Settings, "Short URLs (port 80)"), names open as
  `http://name.localhost`. Studio listens on port 80 itself and forwards every connection to the
  proxy, which stays on `proxyPort` (1355), so nothing asks for sudo. It works only where this
  user may listen on port 80 without sudo; otherwise Studio logs why, names keep `:1355` and the
  doctor says so. URLs in the page, `list`, MCP and notifications drop the port only while Studio
  listens. The doctor's "Shorter URLs" check tests port 80 without sudo, offers Use short URLs,
  and on Linux shows the one-time `sysctl` command and how to keep it. The default stays off.
- Doctor fixes that change the proxy port (Use HTTP on port 1355, Use short URLs) check the result
  and go back to the previous settings when it fails, starting the proxy again on its old port.
  The doctor no longer offers to start the proxy below port 1024 on Linux or macOS, where portless
  always asks for sudo.
- Studio's own `studio` route no longer shows in the routes list, its counts, filters or
  notifications. `showStudioRoute: true` (Settings, "Show Studio in the routes") brings it back,
  and MCP `list_routes` takes `include_studio`.

## 0.1.1 (2026-10-25)

- The proxy start is confirmed: Studio checks the port is free before starting it and that it
  answers afterwards, and says which process holds the port when it cannot start.
- Studio keeps the last good list when it reads portless's routes file while portless is writing
  it, instead of showing an empty list.
- Auto mode waits until a port has been unnamed for two scans in a row, so it no longer races
  `portless <name> <command>`, and checks the routes again right before naming.
- The doctor warns when portless's routes file has entries Studio cannot read.
- Releases publish to npm through Trusted Publishing and create a GitHub release.
- Studio runs on Node 22 or later (it needed 24 before). CI tests Node 22 and 24 on Linux, macOS
  and Windows.
- Update notice: once a day Studio asks the npm registry for the latest version and, when a newer
  one exists, prints one line on start and shows a dismissible banner in the page. Turn it off
  with `checkForUpdates: false`, the Settings switch or `PORTLESS_STUDIO_NO_UPDATE_CHECK=1`; it
  never runs in CI.
- The README has an Install section: try it with `npx`, install globally for everyday use and
  start at login, and how to update and uninstall. `service install` run from the npx cache now
  prints the exact commands to move to a global install.

## 0.1.0 (2026-10-25)

The first release.

- Live list of portless routes with name, URL, port, kind, uptime, tunnels and health.
- Detected ports: listening ports that answer HTTP and have no name yet, with the process, project
  folder, git branch and a suggested name; name, name all or ignore them.
- Auto mode that names every new dev server and removes those names after their port closes.
- Suggested names from the ticket key or branch, the package and the repository, with a
  configurable `nameTemplate`.
- Name, rename and remove aliases; stop a dev server from its row.
- Views with grouping, sorting, filters, custom groups, favorites and a default view.
- Terminals per project inside Studio, and `portless-studio run` to start one from a shell.
- MCP server (`portless-studio mcp`) for AI agents, `--json` output for `list`, `doctor` and
  `config`, and `portless-studio open` to bring Studio to the front.
- Open with menu for editors, the file manager and custom apps.
- Project icons from the running server, the project folder or Settings.
- Health panel and `portless-studio doctor` with fixes; start, stop and restart the proxy and
  Studio from the page.
- `portless-studio init`, `uninstall` and `service install` for Linux, macOS and Windows.
- In-page and system notifications.
- Install portless from the page when it is missing.
- Keyboard shortcuts for every action and a command menu.
