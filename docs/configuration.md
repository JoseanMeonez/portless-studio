# Configuration

Settings live in one JSON file: `~/.config/portless-studio/config.json` on Linux and macOS (or
under `$XDG_CONFIG_HOME`), `%APPDATA%\portless-studio\config.json` on Windows.
`PORTLESS_STUDIO_CONFIG` sets another path. `portless-studio config` prints the path and the
contents, and `portless-studio config --edit` opens it in `$EDITOR`.

Edit it by hand or from the Settings panel (`,` in the page). A running Studio picks up changes
without a restart. Missing fields take their default, so a file with only the fields you change
is enough:

```json
{
  "autoName": true,
  "ignoredPorts": [8080]
}
```

## Fields

| Field | Default | What it does |
| --- | --- | --- |
| `port` | `4949` | Port Studio listens on, on 127.0.0.1. |
| `autoName` | `false` | Gives every new dev server a portless name automatically. |
| `autoRemoveAfterMinutes` | `10` | Minutes a name auto mode gave survives after its port closes. `0` keeps them. |
| `openBrowser` | `true` | Opens the browser when Studio starts. |
| `registerStudioAlias` | `true` | Registers Studio itself in portless as `studio`. |
| `showStudioRoute` | `false` | Lists that `studio` route with the other routes. Hidden by default because the page is already open. |
| `startProxy` | `true` | Starts the portless proxy when Studio starts and it is not running. |
| `proxyPort` | `1355` | Port of that proxy. 1355 needs no administrator rights. portless asks for sudo below 1024 on Linux and macOS, so use `shortUrls` to drop the port instead. |
| `shortUrls` | `false` | Names open as `http://name.localhost`: Studio listens on port 80 and forwards to the proxy, only where this user may listen there without sudo. HTTP only. See [troubleshooting.md](troubleshooting.md#names-have-1355-and-i-want-port-80). |
| `proxyHttps` | `false` | Serves the names over HTTPS. Browsers then need to trust the portless certificate (see [troubleshooting.md](troubleshooting.md#certificate-warnings)). |
| `scanIntervalMs` | `3000` | How often Studio looks for new listening ports, in milliseconds (at least 1000). |
| `ignoredPorts` | `[]` | Ports never shown as detected and never named automatically. |
| `showEphemeralPorts` | `false` | Lists detected ports in the system's ephemeral range (Linux 32768-60999, macOS and Windows 49152-65535 by default) with the others. Off keeps them under Other ports: they are helper ports of tools like wrangler. Settings: Show temporary ports. |
| `ignoredProcesses` | editors, chat apps, browsers | Process names whose ports are never shown. |
| `views` | one view, `All`, grouped by project | Saved views: grouping, sort, filters and custom groups. |
| `defaultViewId` | `"all"` | The view the page opens with. |
| `favorites` | `[]` | Routes pinned above every group, by name or as `"port:3000"`. |
| `desktopNotifications` | `false` | Notifies from an open Studio tab while it is in the background. |
| `systemNotifications` | `false` | Asks the operating system to notify when no Studio tab is open. |
| `nameTemplate` | `"{work}.{package}.{repo}"` | How suggested names are built. See [naming.md](naming.md). |
| `projectIcons` | `{}` | Icon per project: an emoji, an http(s) image URL or a `data:image` URL. |
| `checkForUpdates` | `true` | Once a day, asks npm whether a newer portless-studio exists. See below. |
| `terminal` | see below | How the terminal panel draws text. Each field is optional. |
| `restoreTerminals` | `"ask"` | What happens on start to the terminals that were running when Studio stopped: `"ask"` lists them with Run again, `"always"` runs their commands again (never plain shells), `"never"` forgets them. See [terminals.md](terminals.md#after-a-studio-restart). |

The `--port`, `--no-open` and `--no-register` flags win over the file for one run.
`PORTLESS_STUDIO_SHORT_URL_PORT` makes short URLs listen on another port than 80, for tests that
must not bind port 80; URLs then carry that port. Apps you add to
the Open with menu live in `open-with.json` next to the config file.

## Terminal look

```json
{
  "terminal": {
    "fontSize": 12,
    "lineHeight": 1.2,
    "cursorStyle": "block",
    "cursorBlink": true,
    "scrollback": 10000,
    "theme": "studio"
  }
}
```

| Field | Allowed | What it does |
| --- | --- | --- |
| `fontSize` | whole number, 10 to 24 | Text size in pixels. |
| `lineHeight` | 1 to 2 | Line height as a multiple of the font size. |
| `cursorStyle` | `"block"`, `"bar"`, `"underline"` | Shape of the cursor. |
| `cursorBlink` | `true`, `false` | Whether the cursor blinks. |
| `scrollback` | whole number, 1000 to 100000 | Lines kept above the screen in the browser. Studio itself keeps the last 2 MB of output per terminal. |
| `theme` | `"studio"`, `"dark"`, `"light"` | `studio` follows the page's light or dark mode; the other two stay fixed. Each has 16 ANSI colors, defined as `--term-*` tokens in `src/web/styles/tokens.css`. |

Settings has a Terminal section with a preview. Saving applies the look to open terminals at once.

## Update notice

Once a day Studio asks the npm registry for the latest version of portless-studio. When a newer
one exists, it prints one line on start and shows a banner in the page with the command to update;
dismissing the banner hides it until the next version. The request is a plain
`GET https://registry.npmjs.org/portless-studio/latest`: Studio sends nothing about your machine,
your projects or your routes. It gives up after 3 seconds and stays quiet when you are offline,
and it keeps the time of the last check in `update-check.json` next to the config file. It never
runs when the `CI` variable is set. Turn it off with `checkForUpdates: false`, the Settings
switch, or `PORTLESS_STUDIO_NO_UPDATE_CHECK=1`.
