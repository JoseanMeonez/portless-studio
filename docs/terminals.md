# Terminals

Studio can run commands for you, one terminal per command, each in a project folder. Their
output shows live in a panel at the bottom (or side) of the dashboard, and you, the CLI and your
AI agents all see and drive the same terminals. The usual case: an agent starts your dev server
with `portless-studio run -- pnpm dev` instead of in its own hidden shell, so you can watch its
logs in Studio, and the port it opens gets a name right away.

## Starting a terminal

From the page:

- Right-click a row (or press `.`) and pick **Open terminal**, or select a row and press `t`.
  Studio shows the running terminal of that project folder, or opens a shell there.
- **New terminal** in the panel picks a project folder and a command. An empty command opens your
  shell.

From a shell, as a drop-in for the command you would run yourself:

```bash
portless-studio run -- pnpm dev
portless-studio run --name pr-87.web.myapp -- pnpm dev --port 3000
portless-studio run --cwd ~/code/myapp/apps/web -- "pnpm dev && pnpm test"
```

`run` asks the running Studio to start the command in the current folder (or `--cwd`), prints its
output in your terminal as it comes, and exits with the command's exit code. Ctrl+C stops the
command; a second Ctrl+C leaves at once. The first new port the command opens in that folder gets
a name: `--name`, or the name Studio suggests from the branch and the project (docs/naming.md).
When Studio is not running, `run` says so and exits with code 1.

Words after `--` are quoted for the shell where needed, so `run -- node "my app.js"` passes
`my app.js` as one argument. A single word is used as written, which keeps `&&` and pipes working.

From an agent, through the MCP tools `run_in_terminal`, `list_terminals`, `read_terminal`,
`send_to_terminal` and `stop_terminal` (docs/mcp.md).

## The panel

Tabs are grouped by project. The toolbar shows whether the command runs or its exit code, and has
Stop, Restart (Run again once it ended), Follow (keep the newest output in view) and Copy output
(the kept output as plain text). Drag the panel's inner edge, or focus it and use the arrow keys,
to resize it; the layout button docks it at the bottom or on the right. Size, dock and whether it
is open are remembered in this browser. Below 640 px wide the panel covers the whole page.

xterm.js draws the terminal. It loads the first time a terminal opens, in its own file, so the
dashboard itself stays small.

## How commands run

| System | How | What it means |
| --- | --- | --- |
| Linux | `script -q -f -e -c "<command>" /dev/null` (util-linux) | A real pseudo-terminal: colors, prompts, progress bars and Ctrl+C work as in your own terminal. |
| macOS | `script -q /dev/null /bin/sh -c "<command>"` (BSD `script`, which takes its arguments in a different order) | The same, best effort; not yet run on a real Mac. |
| Windows | `cmd.exe /d /s /c "<command>"` with plain pipes and `FORCE_COLOR=1` | Most tools still print colors. Programs that need a real console (full-screen UIs, some prompts) behave as when piped. |
| Linux without util-linux `script` (BusyBox, minimal containers) | `/bin/sh -c "<command>"` with pipes and `FORCE_COLOR=1` | As on Windows. |

No native module is involved, so Studio keeps zero runtime dependencies. Each command gets
`TERM=xterm-256color`, `COLUMNS` and `LINES` for the size of the panel that opened it (120 by 30
from the CLI and agents), and `PORTLESS_STUDIO_TERMINAL` with the terminal id. With a
pseudo-terminal, `stty` inside it sets that size first.

The size is set once, when the command starts. Resizing the panel later reflows what xterm.js
shows but does not tell the command: nothing outside a pseudo-terminal made by `script` can change
its size. A full-screen program keeps drawing for the size it started with; restart it to pick up
the new one.

Stop sends Ctrl+C (through the pseudo-terminal, or SIGINT to the command's process group with
pipes), then SIGTERM after 3 seconds and SIGKILL after 3 more while it keeps running. On Windows
every step stops the whole process tree with `taskkill /T /F`.

Each terminal keeps its last 2 MB of output in memory. Every character has a fixed number, so a
page or an agent can ask for only what came after the last part it read (`?from=<n>`), and learns
when older output was dropped. Studio keeps at most 32 terminals; close one to open another.

Terminals belong to the Studio that runs them. When Studio stops, every command still running is
sent SIGTERM and SIGKILL, and the terminals are gone; they do not come back after a restart. If
Studio crashes instead of stopping, commands started in their own process group may keep
running.

## Security

A terminal runs any command as you, so every terminal endpoint needs Studio's per-run token,
reads included, because output and commands can hold secrets. Browsers only let Studio's own page
read the token (docs/architecture.md, Security), so another website open in the same browser can
neither start a command nor read output. Event streams carry the token in the query
(`?token=`), because the browser's EventSource cannot send headers.

Studio limits where commands run:

- **From the page**, only in a project folder of a route or detected port Studio shows or showed,
  or in a folder a local program already used.
- **From a local program** (the CLI, the MCP server), in any existing folder. Studio tells them
  apart by the headers browsers always send (`Origin` on every write, `Sec-Fetch-Site` on every
  request), which `node:http` does not send. A program on your machine that can read Studio's
  token can already run commands as you, so this adds no new power.

The risk to keep in mind: anyone who can run programs as you, or anything you let drive Studio
(such as an AI agent with the MCP server), can run commands through it. Studio listens on
`127.0.0.1` only.

## Bring Studio to the front

`portless-studio open [target]` and the MCP tool `focus_studio` show a route, a project (its first
route, else its first detected port), a terminal id or `port:<number>` in Studio and bring the
page to the front:

1. Studio sends a `focus` event to every open Studio page. The page shows the target (selects the
   row or opens the terminal tab) and calls `window.focus()`.
2. After 300 ms each page says whether it has the focus.
3. When no page is open, or none came forward within 1.5 seconds, Studio opens the page link
   (`/?focus=<route>`, `/?focus=port:<n>` or `/?terminal=<id>`) with the system browser opener
   (`xdg-open`, `open`, `start`). That brings the browser to the front on Linux, macOS and
   Windows, in a new tab.

Browsers decide whether a page may raise its own window: Chrome, Firefox and Safari usually
ignore `window.focus()` from a background tab, so the link in a new tab is the common outcome.
On Linux, some window managers show a "ready" notice instead of raising the browser.

## Opening terminals

- **New terminal** (`Ctrl+\``, the panel's button, or the command menu) lists every project and
  worktree folder Studio knows, with its branch and path, and you can search it. Pick one to open
  your login shell there, or pick **Other folder…** and type any existing folder (`~` is your home
  folder). While a terminal has focus, xterm may keep `Ctrl+\`` for itself; use the panel button.
- The terminal button on a row shows the terminal whose processes serve that row, else a terminal
  in its folder, else opens a shell there.
- A terminal with no command starts your login shell (`$SHELL -l`). On Windows it starts `pwsh` or
  Windows PowerShell, which shows no prompt over pipes, else `cmd.exe`.

## The panel

- Tabs are grouped by project and worktree (`acme-monorepo / falcon`) with the branch. A folder
  Studio does not know is grouped under its own name.
- Double-click a tab, press `F2`, or use Rename to name it. An empty name brings back the command
  or the shell's name.
- The toolbar lists the URLs of ports opened by processes started in that terminal. This works on
  Linux and macOS through parent processes; on Windows nothing is listed.

## Direct URLs

Every route and detected port shows its direct URL (`http://localhost:<port>`); click it to copy.
The row menu has Open direct URL and Copy direct URL, and the command menu has Copy direct URL of
the selected route.

## Folders the page can use

The page's **New terminal** picker can start a terminal in any existing folder you type
(`POST /api/terminals/in-folder`, which needs the token and refuses anything that is not a
folder). Every other page request runs only in folders Studio shows. The CLI and MCP can use any
existing folder, as before.
