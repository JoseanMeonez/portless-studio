import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { ok } from "../../core/result.ts";
import type { Route } from "../../core/routes/route.ts";
import {
  type SpawnRequest,
  type TerminalFolders,
  TerminalManager,
  type TerminalProcess,
  type TerminalSpawner,
  type TerminalWorkspace,
} from "./terminals.ts";

type FakeProcess = TerminalProcess & {
  emit(text: string): void;
  exit(code: number | null): void;
  calls: string[];
  written: string[];
};

function fakeProcess(pid: number): FakeProcess {
  const dataListeners: ((text: string) => void)[] = [];
  const exitListeners: ((code: number | null) => void)[] = [];
  const calls: string[] = [];
  const written: string[] = [];
  return {
    pid,
    calls,
    written,
    write: (text) => written.push(text),
    interrupt: () => calls.push("interrupt"),
    terminate: () => calls.push("terminate"),
    kill: () => calls.push("kill"),
    onData: (listener) => dataListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    emit: (text) => {
      for (const listener of dataListeners) listener(text);
    },
    exit: (code) => {
      for (const listener of exitListeners) listener(code);
    },
  };
}

function fakeSpawner() {
  const spawned: { request: SpawnRequest; process: FakeProcess }[] = [];
  const spawner: TerminalSpawner = {
    mode: "pty",
    spawn: async (request) => {
      const process = fakeProcess(1000 + spawned.length);
      spawned.push({ request, process });
      return process;
    },
  };
  return { spawner, spawned };
}

const folders: TerminalFolders = {
  directory: (dir) => (dir.startsWith("/work") || dir.startsWith("/tmp") ? dir : null),
  contains: (parent, child) => child === parent || child.startsWith(`${parent}/`),
};

function route(name: string, port: number, path: string): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port,
    kind: "alias",
    pid: null,
    registeredAt: 1,
    url: `http://${name}.localhost:1355`,
    tunnels: [],
    project: { name: "shop", worktree: null, path },
  };
}

function fakeWorkspace() {
  const state: { routes: Route[]; detected: DetectedPort[] } = {
    routes: [route("web.shop", 3000, "/work/shop")],
    detected: [],
  };
  const listeners = new Set<() => void>();
  const aliases: string[] = [];
  const workspace: TerminalWorkspace = {
    openableFolders: async () => new Set(["/work/shop"]),
    snapshot: async () => state,
    watch: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    createAlias: async (name, port) => {
      aliases.push(`${name} ${port}`);
      return ok(undefined);
    },
    renameAlias: async (from, to) => {
      aliases.push(`rename ${from} ${to}`);
      return ok(undefined);
    },
  };
  const change = () => {
    for (const listener of listeners) listener();
  };
  return { workspace, state, listeners, aliases, change };
}

function setup(options: { maxOutputChars?: number } = {}) {
  const spawner = fakeSpawner();
  const workspace = fakeWorkspace();
  const manager = new TerminalManager({
    spawner: spawner.spawner,
    workspace: workspace.workspace,
    folders,
    now: () => 1_000,
    graceMs: 100,
    ...options,
  });
  return { manager, ...spawner, ...workspace };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalManager", () => {
  it("starts a command in a folder Studio shows and lists it", async () => {
    const { manager, spawned } = setup();
    const created = await manager.create(
      { cwd: "/work/shop", command: "pnpm dev", cols: 100, rows: 30 },
      { trusted: false },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      id: "t1",
      title: "pnpm dev",
      cwd: "/work/shop",
      command: "pnpm dev",
      project: "shop",
      status: "running",
      pid: 1000,
      mode: "pty",
      cols: 100,
      rows: 30,
    });
    expect(spawned[0]?.request).toMatchObject({
      command: "pnpm dev",
      cwd: "/work/shop",
      cols: 100,
      rows: 30,
    });
    expect(spawned[0]?.request.env).toMatchObject({
      TERM: "xterm-256color",
      COLUMNS: "100",
      LINES: "30",
      PORTLESS_STUDIO_TERMINAL: "t1",
    });
    expect(manager.list().map((item) => item.id)).toEqual(["t1"]);
  });

  it("runs in a project's folder when given its name", async () => {
    const { manager, spawned } = setup();
    const created = await manager.create({ project: "shop" }, { trusted: false });
    expect(created.ok).toBe(true);
    expect(spawned[0]?.request).toMatchObject({ cwd: "/work/shop", command: null });
    if (created.ok) expect(created.value.title).toBe("shell");
  });

  it("refuses a folder Studio does not show unless a local program asks", async () => {
    const { manager, spawned } = setup();
    const fromPage = await manager.create({ cwd: "/tmp/other", command: "ls" }, { trusted: false });
    expect(fromPage).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "path_not_allowed" }),
    });
    expect(spawned).toHaveLength(0);

    const fromCli = await manager.create({ cwd: "/tmp/other", command: "ls" }, { trusted: true });
    expect(fromCli.ok).toBe(true);
    // Once a local program used the folder, the page may open terminals there too.
    const again = await manager.create({ cwd: "/tmp/other" }, { trusted: false });
    expect(again.ok).toBe(true);
  });

  it("refuses a folder that does not exist and an unknown project", async () => {
    const { manager } = setup();
    expect(await manager.create({ cwd: "/nope" }, { trusted: true })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "path_not_allowed" }),
    });
    expect(await manager.create({ cwd: "relative/dir" }, { trusted: true })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid_request" }),
    });
    expect(await manager.create({ project: "ghost" }, { trusted: false })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "not_found" }),
    });
  });

  it("keeps output with sequence numbers and streams new output to watchers", async () => {
    const { manager, spawned } = setup();
    const created = await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    if (!created.ok) throw new Error("not created");
    const child = spawned[0]?.process;
    child?.emit("hello ");
    const seen: string[] = [];
    const watched = manager.subscribe("t1", 0, {
      onOutput: (chunk) => seen.push(`${chunk.seq}:${chunk.data}`),
      onStatus: () => {},
    });
    expect(watched.ok).toBe(true);
    child?.emit("world");
    expect(seen).toEqual(["0:hello ", "6:world"]);

    const read = manager.read("t1", 6);
    expect(read.ok && read.value).toMatchObject({ data: "world", from: 6, next: 11 });
    expect(manager.get("t1")?.nextSeq).toBe(11);
  });

  it("drops the oldest output past the buffer size", async () => {
    const { manager, spawned } = setup({ maxOutputChars: 8 });
    await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    spawned[0]?.process.emit("0123456789");
    const read = manager.read("t1", 0);
    expect(read.ok && read.value).toMatchObject({ data: "23456789", from: 2, truncated: true });
  });

  it("writes input to the command and refuses it once the command ended", async () => {
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    const child = spawned[0]?.process;
    expect(manager.input("t1", "y\n")).toEqual({ ok: true, value: undefined });
    expect(child?.written).toEqual(["y\n"]);
    child?.exit(0);
    expect(manager.input("t1", "y\n")).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "terminal_not_running" }),
    });
    expect(manager.input("nope", "y")).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "not_found" }),
    });
  });

  it("records the exit code and tells watchers", async () => {
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    const statuses: string[] = [];
    manager.subscribe("t1", 0, {
      onOutput: () => {},
      onStatus: (info) => statuses.push(`${info.status}:${info.exitCode}`),
    });
    let listChanges = 0;
    manager.watch(() => {
      listChanges += 1;
    });
    spawned[0]?.process.exit(3);
    expect(manager.get("t1")).toMatchObject({ status: "exited", exitCode: 3, endedAt: 1_000 });
    expect(statuses).toEqual(["exited:3"]);
    expect(listChanges).toBe(1);
    const read = manager.read("t1", 0);
    expect(read.ok && read.value.data).toContain("exited with code 3");
  });

  it("stops with Ctrl+C, then SIGTERM, then SIGKILL while the command keeps running", async () => {
    vi.useFakeTimers();
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    const child = spawned[0]?.process;
    expect(manager.stop("t1").ok).toBe(true);
    expect(child?.calls).toEqual(["interrupt"]);
    vi.advanceTimersByTime(100);
    expect(child?.calls).toEqual(["interrupt", "terminate"]);
    vi.advanceTimersByTime(100);
    expect(child?.calls).toEqual(["interrupt", "terminate", "kill"]);
  });

  it("stops escalating once the command ends", async () => {
    vi.useFakeTimers();
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "x" }, { trusted: false });
    const child = spawned[0]?.process;
    manager.stop("t1");
    child?.exit(130);
    vi.advanceTimersByTime(1_000);
    expect(child?.calls).toEqual(["interrupt"]);
  });

  it("restarts the same command in the same terminal, keeping the output", async () => {
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "pnpm dev" }, { trusted: false });
    spawned[0]?.process.emit("first\n");
    spawned[0]?.process.exit(0);
    const restarted = await manager.restart("t1");
    expect(restarted.ok && restarted.value).toMatchObject({ id: "t1", status: "running" });
    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.request.command).toBe("pnpm dev");
    // A late exit of the old process does not end the new one.
    spawned[0]?.process.exit(1);
    expect(manager.get("t1")?.status).toBe("running");
    const read = manager.read("t1", 0);
    expect(read.ok && read.value.data).toMatch(/first\n[\s\S]*restarted/);
  });

  it("closes a terminal and kills every command when Studio stops", async () => {
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "a" }, { trusted: false });
    await manager.create({ cwd: "/work/shop", command: "b" }, { trusted: false });
    expect(manager.remove("t1").ok).toBe(true);
    expect(spawned[0]?.process.calls).toEqual(["kill"]);
    expect(manager.list().map((item) => item.id)).toEqual(["t2"]);
    manager.closeAll();
    expect(spawned[1]?.process.calls).toEqual(["terminate", "kill"]);
  });

  it("names the first new port the command opens in its folder", async () => {
    const { manager, state, aliases, change, listeners } = setup();
    state.detected = [
      { port: 4000, pid: 1, processName: "node", cwd: "/work/old", suggestedName: "old" },
    ];
    await manager.create(
      { cwd: "/work/shop", command: "pnpm dev", name: true },
      { trusted: false },
    );
    expect(manager.get("t1")?.naming).toEqual({
      state: "waiting",
      requested: null,
      name: null,
      port: null,
    });
    expect(listeners.size).toBe(1);
    state.detected = [
      ...state.detected,
      {
        port: 5173,
        pid: 2,
        processName: "node",
        cwd: "/work/shop/apps/web",
        suggestedName: "web.shop",
      },
    ];
    change();
    await vi.waitFor(() => expect(manager.get("t1")?.naming?.state).toBe("named"));
    expect(aliases).toEqual(["web.shop 5173"]);
    expect(manager.get("t1")?.naming).toMatchObject({ name: "web.shop", port: 5173 });
    expect(listeners.size).toBe(0);
  });

  it("uses the name asked for, renaming a route auto mode gave first", async () => {
    const { manager, state, aliases, change } = setup();
    await manager.create(
      { cwd: "/work/shop", command: "pnpm dev", name: "pr-7.shop" },
      { trusted: false },
    );
    state.routes = [...state.routes, route("auto.shop", 5174, "/work/shop")];
    change();
    await vi.waitFor(() => expect(manager.get("t1")?.naming?.state).toBe("named"));
    expect(aliases).toEqual(["rename auto.shop pr-7.shop"]);
    expect(manager.get("t1")?.naming).toMatchObject({ name: "pr-7.shop", port: 5174 });
  });

  it("gives up naming when the command ends first", async () => {
    const { manager, spawned } = setup();
    await manager.create({ cwd: "/work/shop", command: "x", name: true }, { trusted: false });
    spawned[0]?.process.exit(1);
    expect(manager.get("t1")?.naming).toMatchObject({ state: "failed" });
  });
});
