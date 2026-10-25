import { ok } from "../../core/result.ts";
import type { ProcessControl, ProcessOwner } from "./process-control.ts";
import { type StopProcessDeps, stopProcess } from "./stop-process.ts";

function setup(owner: ProcessOwner = "you", platform = "linux") {
  const terminated: number[] = [];
  const processes: ProcessControl = {
    ownerOf: async () => owner,
    terminate: async (pid) => {
      terminated.push(pid);
      return ok(undefined);
    },
  };
  const deps: StopProcessDeps = {
    processes,
    stoppablePids: async () => new Map([[51_002, 3001]]),
    selfPid: 999,
    platform,
  };
  return { deps, terminated };
}

describe("stopProcess", () => {
  it("stops a process of the current user that listens on a detected or routed port", async () => {
    const { deps, terminated } = setup();
    expect(await stopProcess("51002", deps)).toEqual(ok({ pid: 51_002, port: 3001 }));
    expect(terminated).toEqual([51_002]);
  });

  it("refuses a pid that does not listen on a detected or routed port", async () => {
    const { deps, terminated } = setup();
    expect(await stopProcess("1", deps)).toMatchObject({
      ok: false,
      error: { code: "process_not_allowed" },
    });
    expect(terminated).toEqual([]);
  });

  it.each(["root", "other", "unknown"] as const)(
    "refuses a process owned by %s and gives the command",
    async (owner) => {
      const { deps, terminated } = setup(owner);
      const result = await stopProcess("51002", deps);
      expect(result).toMatchObject({ ok: false, error: { code: "process_not_allowed" } });
      expect(terminated).toEqual([]);
    },
  );

  it("never stops Studio itself", async () => {
    const { deps, terminated } = setup();
    deps.stoppablePids = async () => new Map([[999, 4949]]);
    expect((await stopProcess("999", deps)).ok).toBe(false);
    expect(terminated).toEqual([]);
  });

  it.each(["abc", "0", "-5", "1.5", "12abc"])("rejects %s as a pid", async (input) => {
    const { deps } = setup();
    expect(await stopProcess(input, deps)).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("gives the Windows command for a process of another user", async () => {
    const { deps } = setup("other", "win32");
    expect(await stopProcess("51002", deps)).toMatchObject({
      ok: false,
      error: { code: "process_not_allowed", command: "taskkill /F /PID 51002" },
    });
  });
});

describe("verified stop", () => {
  it("reports a replacement listener instead of reporting success and refreshes health", async () => {
    const { deps } = setup();
    const refresh = vi.fn(async () => undefined);
    deps.listeners = async () => [{ pid: 51003, port: 3001 }];
    deps.refresh = refresh;
    deps.settleMs = 0;
    expect(await stopProcess("51002", deps)).toMatchObject({
      ok: false,
      error: { code: "port_in_use", message: expect.stringContaining("51003") },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("reports success only after the port is closed", async () => {
    const { deps } = setup();
    deps.listeners = async () => [];
    deps.settleMs = 0;
    expect(await stopProcess("51002", deps)).toEqual(ok({ pid: 51002, port: 3001 }));
  });
  it("does not report success when the OS scan missed an open port", async () => {
    const { deps } = setup();
    deps.listeners = async () => [];
    deps.portClosed = async () => false;
    deps.settleMs = 0;
    expect(await stopProcess("51002", deps)).toMatchObject({
      ok: false,
      error: { code: "port_in_use" },
    });
  });
  it("stops the bounded command tree root before its children", async () => {
    const { deps, terminated } = setup();
    deps.processes.devTree = async () => [51000, 51002, 51001];
    expect((await stopProcess("51002", deps, true)).ok).toBe(true);
    expect(terminated).toEqual([51000, 51002, 51001]);
  });
  it("checks every owner before signaling any process", async () => {
    const { deps, terminated } = setup();
    deps.processes.devTree = async () => [51000, 51002];
    deps.processes.ownerOf = async (pid) => (pid === 51000 ? "other" : "you");
    expect((await stopProcess("51002", deps, true)).ok).toBe(false);
    expect(terminated).toEqual([]);
  });
  it("refuses a tree containing Studio before sending signals", async () => {
    const { deps, terminated } = setup();
    deps.processes.devTree = async () => [999, 51002];
    expect((await stopProcess("51002", deps, true)).ok).toBe(false);
    expect(terminated).toEqual([]);
  });
  it("refuses unsupported tree detection without silently doing a single stop", async () => {
    const { deps, terminated } = setup();
    expect(await stopProcess("51002", deps, true)).toMatchObject({
      ok: false,
      error: { code: "unsupported" },
    });
    expect(terminated).toEqual([]);
  });
});
