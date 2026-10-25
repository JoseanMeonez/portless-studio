# Command line

Every command, flag and environment variable of `portless-studio`. `portless-studio --help`
prints the same list.

## Commands

| Command | What it does |
| --- | --- |
| `portless-studio` | Starts Studio with the settings from the config file. |
| `portless-studio init [--yes]` | Checks portless and offers to install it, asks the basic settings, names the dev servers already running and starts the proxy. Safe to run again. See [getting-started.md](getting-started.md). |
| `portless-studio uninstall [--yes]` | Undoes the setup: removes the login service, the names auto mode gave and the `studio` name, and stops the proxy if Studio started it. Names you or an agent gave stay. Asks before deleting the settings folder. |
| `portless-studio service install` | Starts Studio when you log in: a systemd user unit on Linux, a LaunchAgent on macOS, a script in the Startup folder on Windows. Run it from a global install, not `npx`, which npm's cache can lose. |
| `portless-studio service uninstall` | Undoes `service install`. |
| `portless-studio service status` | Says whether the login service is installed and running. |
| `portless-studio config [--edit] [--json]` | Prints the config file path and contents, or opens it in `$EDITOR`. |
| `portless-studio doctor [--json]` | Checks portless, the proxy, the certificate, Studio's port and the login service, and prints the fix for each problem. Exits with 1 when something fails. |
| `portless-studio list [--json]` | Lists named routes and ports without a name. Reads from the running Studio, or directly from portless and the system when Studio is not running. |
| `portless-studio mcp` | Runs the MCP server on stdio for AI agents. See [mcp.md](mcp.md). |
| `portless-studio run [--name <name>] [--cwd <dir>] -- <command...>` | Runs a command in a Studio terminal, names the port it opens and prints its output until Ctrl+C, which stops it. Needs a running Studio. See [terminals.md](terminals.md). |
| `portless-studio open [target]` | Brings Studio to the front showing a route, project, terminal id or `port:<n>`. |

## Flags

| Flag | Effect |
| --- | --- |
| `--port <n>` | Port for the dashboard on 127.0.0.1. Default: `port` in the config, 4949. `0` picks a free one. |
| `--no-open` | Do not open the browser. |
| `--no-register` | Do not register the `studio` name in portless. |
| `-y`, `--yes` | With `init` and `uninstall`: accept every default. |
| `--json` | With `doctor`, `config` and `list`: print JSON for scripts and agents. |
| `--name <name>` | With `run`: name for the port the command opens. Default: the suggested name. |
| `--cwd <dir>` | With `run`: folder to run in. Default: the current folder. |
| `-h`, `--help` | Show the help. |
| `-v`, `--version` | Show the version. |

`--port`, `--no-open` and `--no-register` win over the config file for one run.

## Environment variables

| Variable | What it does |
| --- | --- |
| `PORTLESS_STUDIO_CONFIG` | Path of the config file. |
| `PORTLESS_STATE_DIR` | portless state folder. Default `~/.portless`. |
| `PORTLESS_BIN` | portless binary used to create and remove names. Default `portless`. |
| `PORTLESS_STUDIO_URL` | Studio that `mcp`, `list`, `run` and `open` talk to. Default `http://127.0.0.1:<port>`. |
| `PORTLESS_STUDIO_NO_UPDATE_CHECK` | `1` turns the daily update check off, whatever the config says. |
| `EDITOR` | Editor that `config --edit` opens. |
