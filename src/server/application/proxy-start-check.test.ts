import { err, ok } from "../../core/result.ts";
import { appError } from "./app-error.ts";
import type { ListeningPort } from "./port-scanner.ts";
import { confirmProxyStarts, type ProxyStartCheckDeps } from "./proxy-start-check.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";

type World = {
  /** What listens on each port right now. */
  listeners: ListeningPort[];
  /** The pid portless recorded in this state dir, and whether it is alive. */
  statePid: number | null;
  alive: boolean;
  /** Portless proxy processes, whatever state dir they use. */
  proxyPids: number[];
  starts: number;
};

const listener = (port: number, pid: number | null, processName = "node"): ListeningPort => ({
  port,
  pid,
  processName,
  cwd: null,
});

function setup(world: World, onStart: (world: World) => void) {
  const inner = setupInner(world, onStart);
  const deps: ProxyStartCheckDeps = {
    scan: async () => world.listeners,
    proxyPids: async (pids) => new Set(pids.filter((pid) => world.proxyPids.includes(pid))),
    sleep: async () => {},
    attempts: 5,
  };
  return confirmProxyStarts(inner, deps);
}

const freshWorld = (): World => ({
  listeners: [],
  statePid: null,
  alive: false,
  proxyPids: [],
  starts: 0,
});

describe("confirmProxyStarts", () => {
  it("accepts a start once the recorded proxy is alive and listens on the port", async () => {
    const world = freshWorld();
    const registry = setup(world, (w) => {
      w.statePid = 700;
      w.alive = true;
      w.proxyPids.push(700);
      w.listeners.push(listener(1355, 700));
    });
    expect(await registry.startProxy(1355, false)).toEqual(ok(undefined));
  });

  it("waits for a proxy that takes a moment to listen", async () => {
    const world = freshWorld();
    let scans = 0;
    const registry = confirmProxyStarts(
      setupInner(world, (w) => {
        w.statePid = 700;
        w.alive = true;
      }),
      {
        scan: async () => {
          scans += 1;
          // Free before the start, then not listening yet, then listening.
          return scans >= 3 ? [listener(1355, 700)] : [];
        },
        sleep: async () => {},
        attempts: 5,
      },
    );
    expect(await registry.startProxy(1355, false)).toEqual(ok(undefined));
  });

  it("does not try when another portless proxy already holds the port", async () => {
    const world = freshWorld();
    world.listeners.push(listener(1355, 900));
    world.proxyPids.push(900);
    const registry = setup(world, () => {});
    const result = await registry.startProxy(1355, false);
    expect(world.starts).toBe(0);
    expect(result).toEqual(
      err(
        appError(
          "port_in_use",
          "port 1355 is already used by another portless proxy (pid 900) that keeps its state " +
            "in a different folder. Stop that proxy, or set proxyPort to a free port.",
        ),
      ),
    );
  });

  it("does not try when another process holds the port", async () => {
    const world = freshWorld();
    world.listeners.push(listener(1355, 321, "python3"));
    const registry = setup(world, () => {});
    const result = await registry.startProxy(1355, false);
    expect(world.starts).toBe(0);
    expect(result).toEqual(
      err(appError("port_in_use", "port 1355 is in use by another process (python3, pid 321).")),
    );
  });

  it("reports the holder when portless exits 0 but its proxy never listens", async () => {
    const world = freshWorld();
    // The port looks free at first, and another process takes it while portless starts.
    const registry = setup(world, (w) => {
      w.listeners.push(listener(1355, 900));
      w.proxyPids.push(900);
    });
    const result = await registry.startProxy(1355, false);
    expect(result).toEqual(
      err(
        appError(
          "port_in_use",
          "port 1355 is already used by another portless proxy (pid 900) that keeps its state " +
            "in a different folder. Stop that proxy, or set proxyPort to a free port.",
        ),
      ),
    );
  });

  it("says the proxy did not keep running when nothing holds the port", async () => {
    const world = freshWorld();
    const registry = setup(world, (w) => {
      w.statePid = 700;
      w.alive = false;
    });
    expect(await registry.startProxy(1355, false)).toEqual(
      err(
        appError(
          "command_failed",
          "portless reported a start, but no proxy listens on port 1355. Run `portless proxy " +
            "start` in a terminal to see why.",
        ),
      ),
    );
  });

  it("restarts over its own proxy that still holds the port while stopping", async () => {
    const world = freshWorld();
    world.statePid = 700;
    world.listeners.push(listener(1355, 700));
    world.proxyPids.push(700);
    const registry = setup(world, (w) => {
      w.statePid = 701;
      w.alive = true;
      w.listeners = [listener(1355, 701)];
    });
    expect(await registry.startProxy(1355, false)).toEqual(ok(undefined));
    expect(world.starts).toBe(1);
  });

  it("passes a failed start through unchanged", async () => {
    const failing: RouteRegistry = {
      ...setupInner(freshWorld(), () => {}),
      startProxy: async () => err(appError("command_failed", "EACCES")),
    };
    const registry = confirmProxyStarts(failing, { scan: async () => [], sleep: async () => {} });
    expect(await registry.startProxy(1355, false)).toEqual(
      err(appError("command_failed", "EACCES")),
    );
  });

  it("trusts a live proxy pid when the ports cannot be listed", async () => {
    const world = freshWorld();
    const registry = confirmProxyStarts(
      setupInner(world, (w) => {
        w.statePid = 700;
        w.alive = true;
      }),
      {
        scan: async () => {
          throw new Error("netstat failed");
        },
        sleep: async () => {},
      },
    );
    expect(await registry.startProxy(1355, false)).toEqual(ok(undefined));
  });
});

function setupInner(world: World, onStart: (world: World) => void): RouteRegistry {
  return {
    readSnapshot: async (): Promise<PortlessState> => ({
      proxy: { running: world.alive, port: 1355, https: false, tlds: ["localhost"] },
      portless: { installed: true, version: "0.15.11" },
      routes: [],
      readAt: 1,
    }),
    watch: () => () => {},
    createAlias: async () => ok(undefined),
    removeAlias: async () => ok(undefined),
    installPortless: async () => ok({ version: null, output: "" }),
    startProxy: async () => {
      world.starts += 1;
      onStart(world);
      return ok(undefined);
    },
    stopProxy: async () => ok(undefined),
    proxyPid: async () => world.statePid,
  };
}
