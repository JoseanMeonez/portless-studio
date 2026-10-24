import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import { err, ok } from "../../core/result.ts";
import type { ProcessOwner } from "./process-control.ts";
import { controlProxy, type ProxyControlDeps } from "./proxy-control.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";

function setup(
  options: { running?: boolean; owner?: ProcessOwner; installed?: boolean; platform?: string } = {},
) {
  const calls: string[] = [];
  let running = options.running ?? true;
  const registry = {
    readSnapshot: async (): Promise<PortlessState> => ({
      proxy: { running, port: 1355, https: false, tlds: ["localhost"] },
      portless: { installed: options.installed ?? true, version: "0.15.11" },
      routes: [],
      readAt: 1,
    }),
    proxyPid: async () => (running ? 4100 : null),
    startProxy: async (port: number, https: boolean) => {
      calls.push(`start ${port} ${https}`);
      running = true;
      return ok(undefined);
    },
    stopProxy: async () => {
      calls.push("stop");
      running = false;
      return ok(undefined);
    },
  } as unknown as RouteRegistry;
  const deps: ProxyControlDeps = {
    registry,
    processes: { ownerOf: async () => options.owner ?? "you" },
    config: async () => ({ ...DEFAULT_CONFIG, proxyPort: 1355, proxyHttps: false }),
    platform: options.platform ?? "linux",
  };
  return { calls, deps };
}

describe("controlProxy", () => {
  it("starts a stopped proxy with the config's port and protocol", async () => {
    const { calls, deps } = setup({ running: false });
    expect(await controlProxy("start", deps)).toEqual(ok("Started the proxy on port 1355."));
    expect(calls).toEqual(["start 1355 false"]);
  });

  it("does nothing when asked to start a proxy that runs", async () => {
    const { calls, deps } = setup();
    expect((await controlProxy("start", deps)).ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it("stops a proxy the user owns through portless", async () => {
    const { calls, deps } = setup();
    expect(await controlProxy("stop", deps)).toEqual(ok("Stopped the proxy."));
    expect(calls).toEqual(["stop"]);
  });

  it("restarts by stopping and starting with the config", async () => {
    const { calls, deps } = setup();
    expect((await controlProxy("restart", deps)).ok).toBe(true);
    expect(calls).toEqual(["stop", "start 1355 false"]);
  });

  it.each(["stop", "restart"] as const)(
    "refuses to %s a proxy owned by root and returns the sudo command",
    async (action) => {
      const { calls, deps } = setup({ owner: "root" });
      expect(await controlProxy(action, deps)).toEqual(
        err({
          code: "needs_admin",
          message: "The proxy runs as root (pid 4100), so stopping it needs sudo.",
          command: "sudo portless proxy stop",
        }),
      );
      expect(calls).toEqual([]);
    },
  );

  it("asks for an Administrator terminal on Windows instead of sudo", async () => {
    const { deps } = setup({ owner: "other", platform: "win32" });
    expect(await controlProxy("stop", deps)).toEqual(
      err({
        code: "needs_admin",
        message:
          "The proxy runs as an Administrator (pid 4100), so stopping it needs a terminal " +
          "opened with Run as Administrator.",
        command: "portless proxy stop",
      }),
    );
  });

  it("needs portless installed", async () => {
    const { deps } = setup({ installed: false });
    expect(await controlProxy("start", deps)).toMatchObject({
      ok: false,
      error: { code: "portless_unavailable" },
    });
  });

  it("passes on a failed stop without starting again", async () => {
    const { calls, deps } = setup();
    deps.registry.stopProxy = async () => err({ code: "internal", message: "no permission" });
    expect(await controlProxy("restart", deps)).toMatchObject({
      ok: false,
      error: { message: "no permission" },
    });
    expect(calls).toEqual([]);
  });
});
