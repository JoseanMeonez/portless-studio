import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import { type ServiceEnv, serviceFile } from "./login-service.ts";
import { createStudioServiceControl } from "./studio-service-control.ts";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const success: CommandResult = { exitCode: 0, output: "", missing: false };

/** A machine with the login service file written, and a runner that records every command. */
function setup(
  platform: NodeJS.Platform,
  options: { installed?: boolean; respond?: (line: string) => CommandResult } = {},
) {
  const commands: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const line = [command, ...args].join(" ");
    commands.push(line);
    return (options.respond ?? (() => success))(line);
  };
  const env: ServiceEnv = {
    platform,
    homeDir: home,
    appDataDir: path.join(home, "AppData", "Roaming"),
    uid: 501,
    nodePath: "/opt/node/bin/node",
    entryPath: "/opt/studio/dist/cli/index.js",
    variables: {},
    run,
    isRunning: async () => true,
  };
  if (options.installed ?? true) {
    const file = serviceFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  }
  let exits = 0;
  const control = createStudioServiceControl({
    env,
    exitSelf: async () => {
      exits += 1;
    },
  });
  return { control, commands, exits: () => exits };
}

async function runPrepared(
  control: ReturnType<typeof setup>["control"],
  action: "restart" | "stop",
) {
  const prepared = await control.prepare(action);
  if (!prepared.ok) throw new Error(prepared.error.message);
  await prepared.value.run();
  return prepared.value;
}

describe("Studio service control", () => {
  it("restarts and stops the systemd user unit on Linux", async () => {
    const { control, commands } = setup("linux");
    await runPrepared(control, "restart");
    const stopped = await runPrepared(control, "stop");
    expect(commands.filter((line) => !line.includes("is-active"))).toEqual([
      "systemctl --user restart portless-studio.service",
      "systemctl --user stop portless-studio.service",
    ]);
    expect(stopped.startCommand).toBe("systemctl --user start portless-studio");
  });

  it("uses launchctl kickstart and bootout on macOS", async () => {
    const { control, commands } = setup("darwin", {
      respond: (line) =>
        line.startsWith("launchctl print") ? { ...success, output: "state = running" } : success,
    });
    await runPrepared(control, "restart");
    await runPrepared(control, "stop");
    expect(commands.filter((line) => !line.startsWith("launchctl print"))).toEqual([
      "launchctl kickstart -k gui/501/dev.portless-studio",
      "launchctl bootout gui/501/dev.portless-studio",
    ]);
  });

  it("explains that Windows cannot restart Studio, and stops it by exiting", async () => {
    const { control, commands, exits } = setup("win32");
    expect(await control.prepare("restart")).toMatchObject({
      ok: false,
      error: { code: "unsupported" },
    });
    const stopped = await runPrepared(control, "stop");
    expect(exits()).toBe(1);
    expect(stopped.startCommand).toBe("portless-studio");
    expect(commands).toEqual([]);
  });

  it("cannot restart a Studio started from a terminal, but can stop it", async () => {
    const { control, exits } = setup("linux", { installed: false });
    expect(await control.prepare("restart")).toMatchObject({
      ok: false,
      error: { code: "unsupported" },
    });
    await runPrepared(control, "stop");
    expect(exits()).toBe(1);
  });

  it("exits by itself when systemctl cannot stop the unit", async () => {
    const { control, exits } = setup("linux", {
      respond: (line) => (line.includes(" stop ") ? { ...success, exitCode: 1 } : success),
    });
    await runPrepared(control, "stop");
    expect(exits()).toBe(1);
  });

  it("knows nothing about the service when Studio runs from source", async () => {
    let exits = 0;
    const control = createStudioServiceControl({
      env: null,
      exitSelf: async () => {
        exits += 1;
      },
    });
    expect(await control.status()).toBeNull();
    const prepared = await control.prepare("stop");
    if (prepared.ok) await prepared.value.run();
    expect(exits).toBe(1);
  });
});
