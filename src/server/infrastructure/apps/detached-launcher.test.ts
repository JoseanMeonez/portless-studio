import { EventEmitter } from "node:events";
import { createDetachedLauncher, type SpawnDetached } from "./detached-launcher.ts";

type Call = { command: string; args: readonly string[]; options: Record<string, unknown> };

function fakeSpawn(outcome: "spawn" | Error = "spawn") {
  const calls: Call[] = [];
  let unrefs = 0;
  const spawn: SpawnDetached = (command, args, options) => {
    calls.push({ command, args, options: { ...options } });
    const child = Object.assign(new EventEmitter(), {
      unref: () => {
        unrefs += 1;
      },
    });
    queueMicrotask(() => {
      if (outcome === "spawn") child.emit("spawn");
      else child.emit("error", outcome);
    });
    return child;
  };
  return { spawn, calls, unrefs: () => unrefs };
}

describe("createDetachedLauncher", () => {
  it("starts the program detached with an argument list and lets it go", async () => {
    const fake = fakeSpawn();
    const launcher = createDetachedLauncher({ platform: "linux", spawn: fake.spawn });
    const result = await launcher.launch({ file: "/usr/bin/code", args: ["/home/dev/my app"] });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(fake.calls).toEqual([
      {
        command: "/usr/bin/code",
        args: ["/home/dev/my app"],
        options: {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
          windowsVerbatimArguments: false,
        },
      },
    ]);
    expect(fake.unrefs()).toBe(1);
  });

  it("reports a program that cannot start", async () => {
    const fake = fakeSpawn(Object.assign(new Error("spawn zed ENOENT"), { code: "ENOENT" }));
    const launcher = createDetachedLauncher({ platform: "linux", spawn: fake.spawn });
    expect(await launcher.launch({ file: "zed", args: ["/srv"] })).toEqual({
      ok: false,
      error: { code: "command_failed", message: "Could not start zed: spawn zed ENOENT" },
    });
  });

  it("runs Windows .cmd shims through cmd.exe with every word quoted", async () => {
    const fake = fakeSpawn();
    const launcher = createDetachedLauncher({
      platform: "win32",
      spawn: fake.spawn,
      comSpec: "C:\\Windows\\system32\\cmd.exe",
    });
    await launcher.launch({ file: "C:\\tools\\cursor.cmd", args: ["C:\\code\\my app"] });
    expect(fake.calls[0]).toEqual({
      command: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\tools\\cursor.cmd" "C:\\code\\my app""'],
      options: {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    });
  });

  it("refuses words cmd.exe would read inside quotes", async () => {
    const fake = fakeSpawn();
    const launcher = createDetachedLauncher({ platform: "win32", spawn: fake.spawn });
    const result = await launcher.launch({ file: "C:\\tools\\code.cmd", args: ["C:\\a%PATH%"] });
    expect(result.ok ? null : result.error.code).toBe("command_failed");
    expect(fake.calls).toEqual([]);
  });

  it("passes verbatim arguments as they are, for explorer /select", async () => {
    const fake = fakeSpawn();
    const launcher = createDetachedLauncher({ platform: "win32", spawn: fake.spawn });
    await launcher.launch({
      file: "explorer.exe",
      args: ['/select,"C:\\code\\my app"'],
      windowsVerbatim: true,
    });
    expect(fake.calls[0]?.args).toEqual(['/select,"C:\\code\\my app"']);
    expect(fake.calls[0]?.options.windowsVerbatimArguments).toBe(true);
  });
});
