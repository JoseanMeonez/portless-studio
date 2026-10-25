# Troubleshooting

Start with the doctor. It checks portless, the proxy, the certificate, Studio's port and the login
service, and prints the fix for each problem:

```bash
portless-studio doctor
```

The Health button in the page runs the same checks and has buttons for most fixes. Each section
below starts with what you see, then the cause and the fix.

## "This site can't be reached" on a .localhost name

**You see:** `http://web.myapp.localhost:1355` fails with "This site can't be reached" or
`ERR_CONNECTION_REFUSED`.

**Causes and fixes:**

- **The proxy is not running.** Names only open through the portless proxy. The doctor reports
  "The proxy is not running". Start it from the proxy menu in the page, from the Health panel, or
  with `portless proxy start --port 1355 --no-tls`. With `startProxy: true` (the default), Studio
  starts it every time Studio starts.
- **Wrong port in the URL.** The proxy listens on `proxyPort` from the config, 1355 by default.
  A name opens at `http://<name>.localhost:<proxyPort>`, not on the dev server's own port. Copy
  the URL from the route's row (`c`) instead of typing it.
- **The proxy runs on another port than the config says.** The doctor shows the port the
  running proxy uses ("It serves HTTP on port ..."). Use that port, or restart the proxy from the
  page so it picks up `proxyPort`.
- **The dev server is down.** A route keeps its name after its server stops, and the dot on its
  row shows the port no longer answers. Start the server again.

## Certificate warnings

**You see:** `NET::ERR_CERT_AUTHORITY_INVALID` or "Your connection is not private" on a name.

**Cause:** `proxyHttps` is `true` and the browser does not trust the certificate authority
portless created. On Linux, Chrome and Edge read their own certificate store in `~/.pki/nssdb`,
not the system store, so trusting the certificate system-wide is not enough.

**Fix:** either go back to HTTP (the doctor's "Switch to HTTP on port 1355" button, or set
`proxyHttps` to `false`), or trust the certificate with the command the doctor prints for your
system. On Linux that command uses `certutil` from the `libnss3-tools` package (Debian and
Ubuntu). Studio never changes a certificate store itself.

Plain HTTP on a `.localhost` name is enough for most apps: browsers treat `*.localhost` as a
secure context, so features such as service workers and secure cookies work as they do on HTTPS.

## Port 1355 is already in use

**You see:** `init` or the page says "The portless proxy did not start", and the doctor reports
the proxy is not running.

**Cause:** another program listens on 1355. Often it is a second portless proxy, started as
another user or with other options.

**Fix:** find what holds the port:

```bash
# Linux
ss -ltnp 'sport = :1355'
# macOS
lsof -nP -iTCP:1355 -sTCP:LISTEN
# Windows (PowerShell or cmd)
netstat -ano | findstr :1355
```

If it is a portless proxy started with sudo or as an Administrator, the doctor reports "The proxy
runs as root" (or as an Administrator) with the command to stop it once. If it is another
program, either stop it or set `proxyPort` in the config (`portless-studio config --edit`) to a
free port above 1023 and restart the proxy from the page.

## Names have `:1355` and I want port 80

Port 1355 needs no administrator rights on any system, so the proxy uses it. portless itself asks
for sudo to start its proxy on any port below 1024 on Linux and macOS, even when the system would
let you listen there, so Studio never moves the proxy to port 80. Turn on **Short URLs (port 80)**
in Settings, or the doctor's **Use short URLs** button, instead: Studio listens on port 80 as your
user and forwards every connection to the proxy on 1355, unchanged, WebSockets included. Names
then open as `http://web.myapp.localhost`, and the page, `portless-studio list`, the MCP tools and
notifications show them that way. Studio never runs sudo for it.

It works only where your user may listen on port 80. The "Shorter URLs" check in the Health panel
and the doctor test that without sudo:

- **Windows** usually lets any user listen on port 80, unless a program such as IIS holds it.
- **macOS** 10.14 and later usually allows it too.
- **Linux** lets only root listen below port 1024. Run this once; it lets every user on the
  machine listen on port 80 and up, until the next restart:

  ```bash
  sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80
  ```

  To keep it after a restart:

  ```bash
  echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-portless-studio.conf
  ```

  Then choose **Try port 80 again** in the Health panel, or save the settings again.

When Studio cannot listen on port 80 (another program holds it, or the system refuses), it logs
why, names keep `:1355`, and the doctor says which of the two it is. The Use short URLs button
checks that Studio really listens and puts the previous settings back when it does not. Short URLs
work over HTTP only; with `proxyHttps` on, names keep their port.

## A dev server does not show under Detected

Studio only lists a port under **Detected on this machine** when all of these hold:

| Rule | Why a port fails it | What to do |
| --- | --- | --- |
| The process belongs to you | Studio cannot read processes of other users or the system, so their ports are skipped. A server started with sudo is one of them. | Start it as yourself, or name the port by hand with Name a port (`n`). |
| The port answers HTTP | Databases, gRPC servers and other non-HTTP ports are skipped, and a server still booting may not answer yet. | Wait one scan (3 seconds by default), or name it by hand. |
| The process is not ignored | `ignoredProcesses` skips editors, chat apps and browsers by default (`code`, `cursor`, `slack`, `chrome` and others). A name also matches longer names that start with it and a space, dot, dash or parenthesis, so `code` covers `Code Helper`. | Remove the entry in Settings, under Ignored processes. |
| The port is not ignored | Ignore on a row adds the port to `ignoredPorts`. | Remove it in Settings, under Ignored ports. |
| It runs on a dev runtime | The process must be `node`, `bun`, `deno`, `python`, `ruby`, `php`, `java` or `dotnet`, or a binary built inside the project folder (such as `target/debug/api`). Other programs are treated as apps, not dev servers. | Name it by hand. |
| It has no name yet | A port that already has a portless route shows under Routes, not Detected. Studio's own port and the proxy port never show. | Look under Routes, or search with `/`. |
| Docker is running | Ports a container publishes come from `docker ps`. Without the `docker` command, with Docker stopped, or (on Linux) without permission to use it, Studio shows only ordinary processes. | Start Docker, or add your user to the `docker` group on Linux. |

`portless-studio list` prints the same two lists from a shell, which helps tell a Studio problem
from a page problem.

## Safari does not open .localhost names

Safari does not always send `*.localhost` names to your own machine. Open Studio at
`http://127.0.0.1:4949` and each app at `http://127.0.0.1:<its port>`, or use Chrome, Edge or
Firefox, which always do.

## Windows notes

- Studio needs Node 22 or later and Windows PowerShell 5, which ships with Windows 10 and 11.
- Studio finds a dev server's project folder from the script path in its command line. A server
  started with a relative script, such as `python manage.py runserver`, gets no folder, so it has
  no suggested name and auto mode does not name it. Name it by hand.
- The page can stop Studio but not restart it. Start it again with `portless-studio`.
- The doctor sees only the proxy portless records, so it cannot warn about two proxies running at
  once.
- Commands the doctor shows that need more rights run in a terminal opened with Run as
  Administrator; there is no sudo.

[platforms.md](platforms.md) lists every difference between Linux, macOS and Windows.

## Studio does not start at login

**You see:** Studio worked yesterday and is not running after a restart, or
`portless-studio service status` says the service is installed but not running.

**Cause:** the login service starts Studio from the files npm installed. When you set it up
through `npx`, those files sit in npm's cache, which npm can clear at any time; after that the
service has nothing to start. `service install` prints a note when it runs from the npx cache.

**Fix:** install globally and set up the service again:

```bash
npm i -g portless-studio
portless-studio service install
```

If the service is installed and only stopped, the doctor prints the command to start it:
`systemctl --user start portless-studio` on Linux,
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.portless-studio.plist` on macOS, or
`portless-studio` on Windows.

## Start over

`uninstall` undoes everything `init` did:

```bash
portless-studio uninstall
```

It removes the login service, the names auto mode gave and the `studio` name, and stops the proxy
if Studio started it. Names you or an agent gave stay. It asks before deleting the settings
folder. Add `--yes` to accept every default. Then run `portless-studio init` for a fresh setup,
or remove the package with `npm rm -g portless-studio`. portless itself stays installed; remove it
with `npm uninstall -g portless`.

## Still stuck

Open an issue with the bug report form. It asks for your system, the versions and the output of
`portless-studio doctor`; remove folder paths and route names you do not want public before you
post it.
