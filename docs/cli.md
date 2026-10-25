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
| `portless-studio env [--prefix P] [--strip S] [--direct] [--json] [name...]` | Prints `KEY=url` lines for a `.env` file, one per route. See [Lines for .env files](#lines-for-env-files). |
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
| `--json` | With `doctor`, `config`, `list` and `env`: print JSON for scripts and agents. |
| `--prefix <p>` | With `env`: put `p` in front of every key, such as `VITE_` or `NEXT_PUBLIC_`. A missing trailing `_` is added. |
| `--strip <s>` | With `env`: drop the `.s` suffix from names before they become keys, so `--strip acme` turns `api.acme` into `API_URL`. |
| `--direct` | With `env`: use `http://localhost:<port>` instead of the named URL. |
| `--name <name>` | With `run`: name for the port the command opens. Default: the suggested name. |
| `--cwd <dir>` | With `run`: folder to run in. Default: the current folder. |
| `-h`, `--help` | Show the help. |
| `-v`, `--version` | Show the version. |

`--port`, `--no-open` and `--no-register` win over the config file for one run.

## Lines for .env files

`env` turns route names into variables, so an app that calls another one keeps a URL that does not
change when the other app's port does. The key is the route name in capitals, with every other
character turned into `_` and `_URL` at the end: `api.acme` gives `API_ACME_URL`. The value is the
route's URL, the same one `list` prints (without the port while short URLs are on). Lines come
sorted by name, and a value is quoted only when it holds spaces, `#`, quotes, `$` or `\`.

```bash
$ portless-studio env
API_ACME_URL=http://api.acme.localhost:1355
WEB_ACME_URL=http://web.acme.localhost:1355

# Only the acme routes, for a Vite app, without the project in the keys
$ portless-studio env --prefix VITE_ --strip acme acme >> apps/web/.env.local
$ cat apps/web/.env.local
VITE_API_URL=http://api.acme.localhost:1355
VITE_WEB_URL=http://web.acme.localhost:1355
```

Each name keeps that route and every route ending in `.<name>`, so `acme` keeps `api.acme` and
`web.acme`. A name that matches no route, a prefix that is not a variable name, or two routes that
would get the same key end the command with an error and exit code 1. Only the lines go to
stdout, so redirecting into a file is safe. Like `list`, `env` reads the running Studio and falls
back to portless when Studio is not running. `--json` prints
`{ "source": "studio", "variables": [{ "name", "key", "value" }] }`.

## Environment variables

| Variable | What it does |
| --- | --- |
| `PORTLESS_STUDIO_CONFIG` | Path of the config file. |
| `PORTLESS_STATE_DIR` | portless state folder. Default `~/.portless`. |
| `PORTLESS_BIN` | portless binary used to create and remove names. Default `portless`. |
| `PORTLESS_STUDIO_URL` | Studio that `mcp`, `list`, `env`, `run` and `open` talk to. Default `http://127.0.0.1:<port>`. |
| `PORTLESS_STUDIO_NO_UPDATE_CHECK` | `1` turns the daily update check off, whatever the config says. |
| `EDITOR` | Editor that `config --edit` opens. |
