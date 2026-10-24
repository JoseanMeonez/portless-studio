import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ok } from "../../../core/result.ts";
import type { TerminalMode } from "../../../core/terminals/terminal.ts";
import { type SpawnRequest, TerminalManager } from "../../application/terminals.ts";
import {
  createTerminalSpawner,
  detectTerminalMode,
  nodeTerminalFolders,
  planTerminal,
} from "./terminal-spawner.ts";

const request: SpawnRequest = {
  command: "pnpm dev",
  cwd: "/work/shop",
  cols: 100,
  rows: 30,
  env: { TERM: "xterm-256color" },
};
const context = { shell: "/bin/zsh", comSpec: "C:\\Windows\\system32\\cmd.exe" };

describe("planTerminal", () => {
  it("wraps the command in util-linux script on Linux, sized with stty", () => {
    expect(planTerminal(request, { ...context, platform: "linux", mode: "pty" })).toEqual({
      file: "script",
      args: ["-q", "-f", "-e", "-c", "stty cols 100 rows 30 2>/dev/null; pnpm dev", "/dev/null"],
      env: { TERM: "xterm-256color", SHELL: "/bin/sh" },
      detached: true,
      windowsVerbatimArguments: false,
    });
  });

  it("uses the BSD script argument order on macOS", () => {
    const plan = planTerminal(request, { ...context, platform: "darwin", mode: "pty" });
    expect(plan.args).toEqual([
      "-q",
      "/dev/null",
      "/bin/sh",
      "-c",
      "stty cols 100 rows 30 2>/dev/null; pnpm dev",
    ]);
  });

  it("starts the user's shell when there is no command", () => {
    const plan = planTerminal(
      { ...request, command: null },
      { ...context, platform: "linux", mode: "pty" },
    );
    expect(plan.args[4]).toBe("stty cols 100 rows 30 2>/dev/null; exec '/bin/zsh'");
    const pipes = planTerminal(
      { ...request, command: null },
      { ...context, platform: "linux", mode: "pipes" },
    );
    expect(pipes.args).toEqual(["-c", "exec '/bin/zsh' -i"]);
  });

  it("uses sh with forced colors when script is missing", () => {
    expect(planTerminal(request, { ...context, platform: "linux", mode: "pipes" })).toEqual({
      file: "/bin/sh",
      args: ["-c", "pnpm dev"],
      env: { TERM: "xterm-256color", FORCE_COLOR: "1" },
      detached: true,
      windowsVerbatimArguments: false,
    });
  });

  it("uses cmd.exe with pipes on Windows", () => {
    expect(planTerminal(request, { ...context, platform: "win32", mode: "pty" })).toEqual({
      file: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '"pnpm dev"'],
      env: { TERM: "xterm-256color", FORCE_COLOR: "1" },
      detached: false,
      windowsVerbatimArguments: true,
    });
  });
});

describe("nodeTerminalFolders", () => {
  it("compares folders by path segments, case-insensitively on Windows", () => {
    const posix = nodeTerminalFolders("linux");
    expect(posix.contains("/work/shop", "/work/shop/apps/web")).toBe(true);
    expect(posix.contains("/work/shop", "/work/shop")).toBe(true);
    expect(posix.contains("/work/shop", "/work/shopping")).toBe(false);
    expect(posix.contains("/work/shop", "/work")).toBe(false);
    expect(nodeTerminalFolders("win32").contains("C:\\Work\\Shop", "c:\\work\\shop\\web")).toBe(
      true,
    );
  });
});

const node = JSON.stringify(process.execPath);
const posix = process.platform !== "win32";
let scratch: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-terminal-"));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function managerFor(mode: TerminalMode) {
  return new TerminalManager({
    spawner: createTerminalSpawner({ mode }),
    workspace: {
      openableFolders: async () => new Set(),
      snapshot: async () => ({ routes: [], detected: [] }),
      watch: () => () => {},
      createAlias: async () => ok(undefined),
      renameAlias: async () => ok(undefined),
    },
    folders: nodeTerminalFolders(),
    graceMs: 300,
  });
}

async function runUntilExit(manager: TerminalManager, command: string) {
  const created = await manager.create({ cwd: scratch, command }, { trusted: true });
  if (!created.ok) throw new Error(created.error.message);
  const id = created.value.id;
  await vi.waitFor(() => expect(manager.get(id)?.status).toBe("exited"), { timeout: 10_000 });
  const read = manager.read(id, 0);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

describe("TerminalManager with real commands", () => {
  it.skipIf(!posix)("runs a command through pipes and keeps its output and exit code", async () => {
    const manager = managerFor("pipes");
    const result = await runUntilExit(manager, `${node} -e "console.log('hi'); process.exit(4)"`);
    expect(result.data).toContain("hi\n");
    expect(result.terminal).toMatchObject({ exitCode: 4, mode: "pipes", cwd: scratch });
  });

  it.skipIf(!posix)("passes input to the command's stdin", async () => {
    const manager = managerFor("pipes");
    const created = await manager.create(
      {
        cwd: scratch,
        command: `${node} -e "process.stdin.once('data', (d) => { console.log('got ' + d.toString().trim()); process.exit(0); })"`,
      },
      { trusted: true },
    );
    if (!created.ok) throw new Error(created.error.message);
    expect(manager.input(created.value.id, "pear\r").ok).toBe(true);
    await vi.waitFor(() => expect(manager.get(created.value.id)?.status).toBe("exited"), {
      timeout: 10_000,
    });
    const read = manager.read(created.value.id, 0);
    expect(read.ok && read.value.data).toContain("got pear");
  });

  it.skipIf(!posix)("escalates to SIGTERM when the command ignores Ctrl+C", async () => {
    const manager = managerFor("pipes");
    const created = await manager.create(
      {
        cwd: scratch,
        command: `${node} -e "process.on('SIGINT', () => console.log('ignored')); console.log('up'); setInterval(() => {}, 1000)"`,
      },
      { trusted: true },
    );
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value.id;
    await vi.waitFor(
      () => {
        const read = manager.read(id, 0);
        expect(read.ok && read.value.data).toContain("up");
      },
      { timeout: 10_000 },
    );
    manager.stop(id);
    await vi.waitFor(() => expect(manager.get(id)?.status).toBe("exited"), { timeout: 10_000 });
    const read = manager.read(id, 0);
    expect(read.ok && read.value.data).toContain("ignored");
  });

  it("refuses a folder that does not exist", async () => {
    const manager = managerFor("pipes");
    const created = await manager.create(
      { cwd: path.join(scratch, "missing"), command: "ls" },
      { trusted: true },
    );
    expect(created).toMatchObject({ ok: false, error: { code: "path_not_allowed" } });
  });
});

describe.skipIf(process.platform !== "linux")("pseudo-terminal through util-linux script", () => {
  let mode: TerminalMode = "pipes";
  beforeAll(async () => {
    mode = await detectTerminalMode("linux");
  });

  it("runs the command in a real terminal and echoes input", async (context) => {
    if (mode !== "pty") context.skip();
    const manager = managerFor("pty");
    const created = await manager.create(
      {
        cwd: scratch,
        command: `${node} -e "console.log(process.stdout.isTTY ? 'tty' : 'pipe'); process.stdin.once('data', () => process.exit(7))"`,
        cols: 90,
        rows: 20,
      },
      { trusted: true },
    );
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value.id;
    await vi.waitFor(
      () => {
        const read = manager.read(id, 0);
        expect(read.ok && read.value.data).toContain("tty");
      },
      { timeout: 10_000 },
    );
    manager.input(id, "x\r");
    await vi.waitFor(() => expect(manager.get(id)?.status).toBe("exited"), { timeout: 10_000 });
    const read = manager.read(id, 0);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.data).toContain("x");
    expect(read.value.terminal).toMatchObject({ exitCode: 7, mode: "pty" });
  });

  it("stops the command with Ctrl+C", async (context) => {
    if (mode !== "pty") context.skip();
    const manager = managerFor("pty");
    const created = await manager.create(
      { cwd: scratch, command: `${node} -e "console.log('up'); setInterval(() => {}, 1000)"` },
      { trusted: true },
    );
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value.id;
    await vi.waitFor(
      () => {
        const read = manager.read(id, 0);
        expect(read.ok && read.value.data).toContain("up");
      },
      { timeout: 10_000 },
    );
    manager.stop(id);
    await vi.waitFor(() => expect(manager.get(id)?.status).toBe("exited"), { timeout: 10_000 });
    expect(manager.get(id)?.exitCode).not.toBe(0);
  });
});
