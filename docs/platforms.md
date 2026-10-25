# Linux, macOS and Windows

Portless Studio runs on Node 22 or later on all three systems and installs nothing beyond
portless itself. Each feature uses tools the system already ships with. This page says which
tool each feature uses on each system, where Studio keeps its files, and what does not work the
same everywhere.

## What works where

| Feature | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Find listening ports | `/proc/net/tcp` and `/proc/<pid>/fd` | `lsof` | `netstat -ano` |
| Process name and executable | `/proc/<pid>/exe` | `lsof` and `ps -ww -o comm=` | PowerShell `Get-CimInstance Win32_Process` |
| When a server started (uptime) | Field 22 of `/proc/<pid>/stat` and `btime` in `/proc/stat` | `ps -o etime=` | `Win32_Process` `CreationDate` |
| Project folder of a dev server | `/proc/<pid>/cwd` | `lsof -d cwd` | The script path in the process's command line |
| Auto mode and suggested names | Yes | Yes | Yes, when the command line names a script by its full path |
| Find every portless proxy | `/proc/<pid>/cmdline` | `ps -ww -A` | Only the one portless records in `proxy.port` |
| Stop a dev server | SIGTERM, then SIGKILL after 5 s | SIGTERM, then SIGKILL after 5 s | `taskkill /T`, or `taskkill /T /F` at once for console programs |
| Start at login | systemd user unit | LaunchAgent | Hidden script in the Startup folder |
| Restart or stop Studio from the page | Through systemd | Through launchd | Stop only: Windows has no service manager Studio can ask |
| System notifications | `notify-send`; a click opens the item | `terminal-notifier`, or `osascript` without click | PowerShell toast; a click opens the item |
| HTTPS trust check | Chrome's store, `~/.pki/nssdb` | `security find-certificate` | `certutil -verifystore Root` |
| Proxy on a port below 1024 | portless asks for sudo | portless asks for sudo | No Administrator needed |
| Short URLs (Studio on port 80) | `ip_unprivileged_port_start` lowered once | Usually allowed; Studio tests it | Usually allowed; Studio tests it |
| Docker containers in Detected | `docker ps` (Docker Engine) | `docker ps` (Docker Desktop, OrbStack, Colima) | `docker ps` (Docker Desktop) |
| Stop a container | `docker stop <name>` | `docker stop <name>` | `docker stop <name>` |

Every check only reads; Studio never changes a certificate store or a system setting on its
own.

## Where Studio keeps its files

| System | Config folder |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/portless-studio`, or `~/.config/portless-studio` |
| macOS | `$XDG_CONFIG_HOME/portless-studio`, or `~/.config/portless-studio` |
| Windows | `%APPDATA%\portless-studio`, for example `C:\Users\dev\AppData\Roaming\portless-studio` |

`PORTLESS_STUDIO_CONFIG` overrides the config file path on every system. The folder holds
`config.json`, which you edit, and `auto-named.json` and `proxy-started.json`, which Studio
writes. portless keeps its own state in `~/.portless`, or in `PORTLESS_STATE_DIR`.

The login service lives in:

| System | File |
| --- | --- |
| Linux | `~/.config/systemd/user/portless-studio.service` |
| macOS | `~/Library/LaunchAgents/dev.portless-studio.plist`, with its log in `~/Library/Logs/portless-studio.log` |
| Windows | `portless-studio.vbs` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` |

## How some features work on each system

### Starting commands on Windows

portless and npm install on Windows as `.cmd` scripts, which only `cmd.exe` can start. Studio
looks each command up on `PATH` with `PATHEXT`. An `.exe` such as `netstat`, `taskkill` or
`powershell` starts directly. A `.cmd` or `.bat` runs through `cmd.exe` with every argument
quoted and every character `cmd.exe` treats specially escaped, so a path like
`C:\Program Files\nodejs\npm.cmd` works. When a command runs past its time limit, Studio stops
its whole process tree with `taskkill /T /F`, because stopping `cmd.exe` alone would leave the
command running.

Output is read as UTF-8. Node programs such as portless and npm write UTF-8, and Studio's
PowerShell scripts set their output to UTF-8, so names and paths with letters like `ñ` or `é`
survive.

### Dev server folders on Windows

Windows has no command that prints another process's working folder. Studio reads the command
line instead: `node C:\Users\dev\shop\node_modules\vite\bin\vite.js` gives `C:\Users\dev\shop`,
and `node C:\Users\dev\api\server.mjs` gives `C:\Users\dev\api`. A server started with a relative
script, such as `python manage.py runserver`, gets no folder, so it shows without a suggested
name and auto mode does not name it.

The PowerShell query runs once for each new listening process and again after 30 seconds, so most
scans start no PowerShell at all. Ports owned by the kernel (pid 4, for example 445) are never
offered as dev servers.

### Start at login on Windows

`portless-studio service install` writes a VBScript to the Startup folder. It sets `PATH` and the
`PORTLESS_*` variables Studio was installed with, then starts Studio with no window. The file is
UTF-16, so a user folder with non-ASCII letters works. An older `portless-studio.cmd` in the same
folder is removed.

### Start at login on macOS

Installing boots out any loaded copy of the LaunchAgent before loading the new one, so installing
twice works. Stopping Studio from the page boots the agent out until the next login; start it
again with:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.portless-studio.plist
```

### Stopping Studio

Studio removes its `studio` alias when it stops on SIGINT, SIGTERM or SIGHUP (a closed terminal),
and on Windows also on SIGBREAK (Ctrl+Break) and when its console window closes. If Studio was
killed without a chance to clean up, the next start replaces a `studio` alias whose port no longer
answers as a Studio.

### Docker containers

A port a container publishes is held by a root-owned `docker-proxy` on Linux, by
`com.docker.backend` or `vpnkit` on macOS and Windows, or by nothing visible at all, so the port
scan cannot tell it is a dev server. Studio asks Docker instead: once per scan it runs
`docker ps --format '{{json .}}'` with a 2-second limit and keeps the answer for 3 seconds. It
reads each container's name, image, the `com.docker.compose.project` and
`com.docker.compose.service` labels and the host ports in the Ports column (IPv4 and IPv6, and
ranges such as `8000-8002`; UDP ports are skipped). Each published port then goes through the same
HTTP probe and the same filters as any other port: routed ports, `ignoredPorts`, the proxy and
Studio's own port. `ignoredProcesses` matches containers as `docker`.

When `docker` is not installed, Docker is not running, or the user may not use it (on Linux, not in
the `docker` group), the command fails and Studio shows ordinary processes only, without an error.
It asks a stopped Docker again after 15 seconds and a missing `docker` after a minute. The doctor
says, as information, whether it reads containers.

Stop on a container row runs `docker stop <name>`, and only for a container the last `docker ps`
listed. The same works on every system because only the `docker` command is used.

### Port 80 for short URLs

The proxy listens on 1355 by default because no system asks for administrator rights there.
portless asks for sudo to start its proxy below port 1024 on Linux and macOS whatever the system
allows, so Studio keeps the proxy on its port and, with `shortUrls` on, listens on port 80 itself
(`127.0.0.1` and `::1`) and pipes each connection to the proxy. The "Shorter URLs" check binds
`127.0.0.1:80` and closes it at once, without sudo, to learn whether this user may listen there and
whether another program holds it:

- **Windows** lets any user listen on port 80, unless a program such as IIS holds it.
- **macOS** 10.14 and later usually allows it; Studio tests it rather than assuming.
- **Linux** allows it only below `net.ipv4.ip_unprivileged_port_start`, 1024 by default. The
  doctor shows `sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80`, which lasts until the next
  restart, and `echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee
  /etc/sysctl.d/99-portless-studio.conf` to keep it. The setting lets every user on the machine
  listen on port 80 and up. Studio shows the commands and never runs them.

When the bind works, the doctor's Use short URLs button sets `shortUrls` to `true`, checks that
Studio listens, and goes back to the previous settings when it does not. The proxy keeps running
on its port throughout, so names never stop opening.

### Commands that need more rights

Fix commands shown by the doctor and the page are written for the system. On Linux and macOS they
use `sudo`. On Windows they run in a terminal opened with Run as Administrator, for example
`portless proxy stop` or `taskkill /F /PID 4242`.

### Config writes on Windows

Windows refuses to replace a file another program has open, such as an editor or an antivirus
scan. Studio retries the write four times over about 300 ms, then copies the new content over the
file.

## Known limits

- **macOS notification clicks.** Without `terminal-notifier` (`brew install terminal-notifier`),
  notifications come from Script Editor through `osascript`: allow Script Editor in System
  Settings, Notifications, and a click does not open Studio.
- **Safari and `.localhost` names.** Safari does not always send `*.localhost` names to this
  machine. Open Studio at `http://127.0.0.1:4949` and each app at `http://127.0.0.1:<its port>`,
  or use Chrome or Firefox.
- **macOS listeners of other users.** `lsof` without root does not show who holds a port that
  root listens on. The doctor then tries to bind Studio's port and reports it taken by an unknown
  program.
- **Windows Studio restart.** The page can stop Studio but not restart it; start it again with
  `portless-studio`.
- **Windows proxy count.** Studio sees only the proxy portless records, so the doctor cannot warn
  about two proxies running at once.
- **Windows PowerShell toasts** need Windows PowerShell 5, which ships with Windows 10 and 11.
