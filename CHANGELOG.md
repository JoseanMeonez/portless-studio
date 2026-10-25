# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## 0.1.1 (2026-10-25)

- The proxy start is confirmed: Studio checks the port is free before starting it and that it
  answers afterwards, and says which process holds the port when it cannot start.
- Studio keeps the last good list when it reads portless's routes file while portless is writing
  it, instead of showing an empty list.
- Auto mode waits until a port has been unnamed for two scans in a row, so it no longer races
  `portless <name> <command>`, and checks the routes again right before naming.
- The doctor warns when portless's routes file has entries Studio cannot read.
- Releases publish to npm through Trusted Publishing and create a GitHub release.

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
