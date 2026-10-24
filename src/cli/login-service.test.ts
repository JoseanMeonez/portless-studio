import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import {
  installService,
  resolveServiceEntry,
  type ServiceEnv,
  serviceFile,
  serviceStartCommand,
  serviceStatus,
  uninstallService,
} from "./login-service.ts";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const success: CommandResult = { exitCode: 0, output: "", missing: false };

function env(
  platform: NodeJS.Platform,
  respond: (line: string) => CommandResult = () => success,
): ServiceEnv & { commands: string[] } {
  const commands: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const line = [command, ...args].join(" ");
    commands.push(line);
    return respond(line);
  };
  return {
    commands,
    platform,
    homeDir: home,
    appDataDir: path.join(home, "AppData", "Roaming"),
    uid: 501,
    nodePath: "/opt/node/bin/node",
    entryPath: "/opt/studio/dist/cli/index.js",
    variables: { PATH: "/opt/node/bin:/usr/bin" },
    run,
    isRunning: async () => false,
  };
}

describe("linux service", () => {
  it("writes a systemd user unit and enables it", async () => {
    const e = env("linux");
    const result = await installService(e);

    const file = path.join(home, ".config", "systemd", "user", "portless-studio.service");
    expect(result).toEqual({ ok: true, value: { file } });
    const unit = fs.readFileSync(file, "utf8");
    expect(unit).toContain(
      'ExecStart="/opt/node/bin/node" "/opt/studio/dist/cli/index.js" --no-open',
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).toContain('Environment="PATH=/opt/node/bin:/usr/bin"');
    expect(e.commands).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now portless-studio.service",
    ]);
  });

  it("reports a systemctl failure with its output", async () => {
    const e = env("linux", (line) =>
      line.includes("enable") ? { exitCode: 1, output: "no user bus", missing: false } : success,
    );
    expect(await installService(e)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no user bus"),
    });
  });

  it("reports installed and running from the unit file and systemctl", async () => {
    const e = env("linux");
    expect(await serviceStatus(e)).toMatchObject({ installed: false, running: false });
    await installService(e);
    expect(await serviceStatus(e)).toMatchObject({ installed: true, running: true });
    expect(e.commands).toContain("systemctl --user is-active portless-studio.service");
  });

  it("disables and removes the unit on uninstall", async () => {
    const e = env("linux");
    await installService(e);
    e.commands.length = 0;
    expect(await uninstallService(e)).toMatchObject({ ok: true, value: { removed: true } });
    expect(fs.existsSync(serviceFile(e))).toBe(false);
    expect(e.commands).toEqual([
      "systemctl --user disable --now portless-studio.service",
      "systemctl --user daemon-reload",
    ]);
  });
});

describe("macOS service", () => {
  it("writes a LaunchAgent and bootstraps it", async () => {
    const e = env("darwin");
    await installService(e);

    const file = path.join(home, "Library", "LaunchAgents", "dev.portless-studio.plist");
    const plist = fs.readFileSync(file, "utf8");
    expect(plist).toContain("<string>dev.portless-studio</string>");
    expect(plist).toContain("<string>/opt/node/bin/node</string>");
    expect(plist).toContain("<string>/opt/studio/dist/cli/index.js</string>");
    expect(plist).toContain("<string>--no-open</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    // A loaded agent makes bootstrap fail, so a reinstall boots the old one out first.
    expect(e.commands).toEqual([
      "launchctl bootout gui/501/dev.portless-studio",
      `launchctl bootstrap gui/501 ${file}`,
    ]);
  });

  it("installs even when there was nothing to boot out", async () => {
    const e = env("darwin", (line) =>
      line.includes("bootout")
        ? { exitCode: 3, output: "Boot-out failed: 3: No such process", missing: false }
        : success,
    );
    expect(await installService(e)).toMatchObject({ ok: true });
    expect(e.commands[1]).toContain("launchctl bootstrap gui/501");
  });

  it("starts a stopped agent again with bootstrap, since kickstart needs it loaded", () => {
    expect(serviceStartCommand(env("darwin"))).toBe(
      "launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.portless-studio.plist",
    );
  });

  it("falls back to launchctl load when bootstrap fails", async () => {
    const e = env("darwin", (line) =>
      line.includes("bootstrap") ? { exitCode: 5, output: "I/O error", missing: false } : success,
    );
    expect(await installService(e)).toMatchObject({ ok: true });
    expect(e.commands[2]).toBe(`launchctl load -w ${serviceFile(e)}`);
  });

  it("boots the agent out and removes it on uninstall", async () => {
    const e = env("darwin");
    await installService(e);
    e.commands.length = 0;
    await uninstallService(e);
    expect(e.commands).toEqual(["launchctl bootout gui/501/dev.portless-studio"]);
    expect(fs.existsSync(serviceFile(e))).toBe(false);
  });

  it("reads running from launchctl print", async () => {
    const e = env("darwin", (line) =>
      line.includes("print") ? { exitCode: 0, output: "state = running", missing: false } : success,
    );
    await installService(e);
    expect(await serviceStatus(e)).toMatchObject({ installed: true, running: true });
  });
});

describe("Windows service", () => {
  const startup = () =>
    path.join(
      home,
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
  // Startup scripts are UTF-16 with a byte order mark, so Windows Script Host reads any path.
  const readScript = (file: string) => {
    const bytes = fs.readFileSync(file);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    return bytes.subarray(2).toString("utf16le");
  };

  it("writes a hidden Startup script that keeps non-ASCII paths and the environment", async () => {
    const e = env("win32");
    e.nodePath = "C:\\Program Files\\nodejs\\node.exe";
    e.entryPath = "C:\\Users\\José Núñez\\studio\\dist\\cli\\index.js";
    e.variables = {
      PATH: 'C:\\Program Files\\nodejs;C:\\tools "x"',
      PORTLESS_STATE_DIR: "D:\\state",
    };
    const result = await installService(e);

    const file = path.join(startup(), "portless-studio.vbs");
    expect(result).toEqual({ ok: true, value: { file } });
    const script = readScript(file);
    expect(script).toContain('env("PATH") = "C:\\Program Files\\nodejs;C:\\tools ""x"""');
    expect(script).toContain('env("PORTLESS_STATE_DIR") = "D:\\state"');
    // Window style 0 runs it hidden; False returns without waiting.
    expect(script).toContain(
      'shell.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\José Núñez\\studio\\dist\\cli\\index.js"" --no-open", 0, False',
    );
  });

  it("replaces the .cmd script older versions wrote", async () => {
    const e = env("win32");
    const legacy = path.join(startup(), "portless-studio.cmd");
    fs.mkdirSync(startup(), { recursive: true });
    fs.writeFileSync(legacy, "@echo off\r\n");
    await installService(e);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("removes the script, and an older .cmd one, on uninstall and reports status from it", async () => {
    const e = env("win32");
    await installService(e);
    expect(await serviceStatus(e)).toMatchObject({ installed: true, running: false });
    const legacy = path.join(startup(), "portless-studio.cmd");
    fs.writeFileSync(legacy, "@echo off\r\n");
    await uninstallService(e);
    expect(await serviceStatus(e)).toMatchObject({ installed: false });
    expect(fs.existsSync(legacy)).toBe(false);
  });
});

describe("resolveServiceEntry", () => {
  it("refuses to install from the TypeScript source", () => {
    expect(resolveServiceEntry("file:///repo/src/cli/index.ts")).toMatchObject({
      ok: false,
      error: expect.stringContaining("pnpm build"),
    });
  });

  it("uses the built entry", () => {
    expect(resolveServiceEntry("file:///repo/dist/cli/index.js")).toEqual({
      ok: true,
      value: "/repo/dist/cli/index.js",
    });
  });
});
