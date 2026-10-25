# Getting started

This walkthrough takes about five minutes. At the end you have the portless proxy running, Studio
open in your browser, a dev server opening at a name like `http://web.myapp.localhost:1355`
instead of `http://localhost:5173`, a port you named by hand, a dev server running in a Studio
terminal, and auto mode naming new dev servers for you.

You need Node 22 or later. Studio installs portless for you if it is missing.

## 1. Run the setup

```bash
npx portless-studio init
```

`init` asks four questions and then does the work:

1. **portless.** When the `portless` command is missing, it offers to run
   `npm install -g portless`.
2. **Settings.** Turn on auto mode, start Studio when you log in, the port for Studio (default
   4949) and whether to open the browser when Studio starts. Answer no to auto mode for now; step
   6 turns it on from the page so you can see what it does. Answer no to start at login too when
   you run through `npx`: the login service needs a global install (see
   [Troubleshooting](troubleshooting.md#studio-does-not-start-at-login)).
3. **Dev servers already running.** It prints a table of the ports that answer HTTP and have no
   name (port, process, folder, suggested name) and asks whether to name them.
4. **Proxy.** It starts the portless proxy on port 1355 over plain HTTP, which needs no password
   and no certificate on any system.

It ends with a summary like this:

```text
All set.
  Config file    ~/.config/portless-studio/config.json
  Names created  1
  Studio         http://studio.localhost:1355
```

`init` is safe to run again. `init --yes` accepts every default without asking.

## 2. Start Studio

```bash
npx portless-studio
```

Studio listens on `http://127.0.0.1:4949`, registers itself in portless as `studio`, and opens
your browser. The page has three parts:

- **The header**: the proxy status, the Health button (checks with a fix for each problem), the
  Name a port button and Settings.
- **Detected on this machine**: listening ports that answer HTTP but have no name yet. Each row
  shows the port, the process, the project folder and a suggested name, with Name and Ignore
  buttons. The section is hidden when there is nothing to show.
- **Routes**: every portless name, grouped by project. Each row shows the URL, the port, the git
  branch and folder the server runs in, how long it has been up, and a dot that is green when the
  port answers.

To look around without touching your machine, open `http://127.0.0.1:4949/?demo` for sample data.

## 3. See a dev server get a name

Start any dev server in a project, in another terminal:

```bash
cd ~/code/myapp
pnpm dev
```

Within a few seconds it appears under **Detected on this machine** with a suggested name built
from the branch, the package and the repository, for example `web.myapp`. Click **Name** and
confirm. The row moves to **Routes**, and the app now opens at
`http://web.myapp.localhost:1355`. Select the row and press `Enter` (or `o`) to open it.

Chrome, Edge and Firefox send every `*.localhost` name to your own machine, so this needs no hosts
file and no DNS setup. Safari does not always do it; see
[Troubleshooting](troubleshooting.md#safari-does-not-open-localhost-names).

[naming.md](naming.md) explains how the suggested name is built and how to change the pattern.

## 4. Name a port by hand

Some ports never show up under Detected: a database in Docker that does not answer HTTP, or a
server another user started. Name those yourself. Click **Name a port** in the header (or press
`n`), enter the port, for example `5432`, and a name, for example `db.myapp`. It opens at
`db.myapp.localhost:1355`. Rename or remove it later from its row (`r` and `Delete`).

The same from a shell, with portless itself:

```bash
portless alias db.myapp 5432
```

Studio shows names created through portless the same way.

## 5. Run a dev server in a Studio terminal

Instead of `pnpm dev`, run:

```bash
npx portless-studio run -- pnpm dev
```

The command runs in a Studio terminal in the current folder. Its output prints in your shell and
in the terminal panel at the bottom of the page, and the first port it opens gets the suggested
name. Ctrl+C in your shell stops it. To pick the name, pass `--name`:

```bash
npx portless-studio run --name pr-87.web.myapp -- pnpm dev
```

From the page, select a route and press `t`, or right-click it and choose **Open terminal**, to
open a terminal in its folder. [terminals.md](terminals.md) covers the panel and the limits.

## 6. Turn on auto mode

In the **Detected on this machine** header, switch on **Auto-name new servers** (also in
Settings, under the same label). From then on every new dev server gets its suggested name by
itself once it has shown up without a name in two scans in a row, about six seconds. Names auto
mode gave are removed 10 minutes after their port closes; names you or an agent gave stay.

## Next steps

- Install Studio globally and start it at login, so names work without opening a terminal:

  ```bash
  npm i -g portless-studio
  portless-studio service install
  ```

- Connect your coding agent: [agents.md](agents.md) and [mcp.md](mcp.md).
- Press `?` in the page for every keyboard shortcut, or see
  [keyboard-shortcuts.md](keyboard-shortcuts.md).
- Something does not open? Run `portless-studio doctor` and read
  [troubleshooting.md](troubleshooting.md).
