import { DEFAULT_CONFIG, type StudioConfig } from "../../core/config/studio-config.ts";
import { err, ok } from "../../core/result.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";
import { type ForwardingPort, publicUrls, ShortUrls } from "./short-urls.ts";

function fakeForwarding(answers: Array<"ok" | "in-use" | "denied"> = []) {
  const calls: string[] = [];
  const forwarding: ForwardingPort = {
    listen: async (port, target) => {
      calls.push(`listen ${port} -> ${target}`);
      const answer = answers.shift() ?? "ok";
      if (answer === "in-use") {
        return err({ reason: "in-use", message: `port ${port} is in use by another program.` });
      }
      if (answer === "denied") {
        return err({ reason: "denied", message: "this system does not let this user listen." });
      }
      return ok({
        port,
        close: async () => {
          calls.push(`close ${port}`);
        },
      });
    },
  };
  return { calls, forwarding };
}

const on: StudioConfig = { ...DEFAULT_CONFIG, shortUrls: true };

describe("ShortUrls.sync", () => {
  it("listens on port 80 and forwards to the proxy port when the config asks for it", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    const status = await shortUrls.sync(on);
    expect(status).toEqual({ state: "listening", port: 80, target: 1355 });
    expect(calls).toEqual(["listen 80 -> 1355"]);
    expect(shortUrls.publicPort()).toBe(80);
  });

  it("does nothing while the config leaves it off", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    expect(await shortUrls.sync(DEFAULT_CONFIG)).toEqual({ state: "off" });
    expect(calls).toEqual([]);
    expect(shortUrls.publicPort()).toBe(null);
  });

  it("keeps the port in URLs and logs why when port 80 is taken", async () => {
    const { forwarding } = fakeForwarding(["in-use"]);
    const lines: string[] = [];
    const shortUrls = new ShortUrls({ forwarding, log: (line) => lines.push(line) });
    const status = await shortUrls.sync(on);
    expect(status).toEqual({
      state: "failed",
      port: 80,
      reason: "in-use",
      message: "port 80 is in use by another program.",
    });
    expect(shortUrls.publicPort()).toBe(null);
    expect(lines).toEqual([
      "short URLs are off: port 80 is in use by another program. Names keep :1355.",
    ]);
  });

  it("tries again on the next sync after a failure", async () => {
    const { forwarding } = fakeForwarding(["denied", "ok"]);
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    expect((await shortUrls.sync(on)).state).toBe("failed");
    expect((await shortUrls.sync(on)).state).toBe("listening");
  });

  it("listens once for the same config and moves to a new proxy port", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    await shortUrls.sync(on);
    await shortUrls.sync(on);
    await shortUrls.sync({ ...on, proxyPort: 1400 });
    expect(calls).toEqual(["listen 80 -> 1355", "close 80", "listen 80 -> 1400"]);
  });

  it("stops listening when turned off, and on close", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    await shortUrls.sync(on);
    await shortUrls.sync(DEFAULT_CONFIG);
    await shortUrls.sync(on);
    await shortUrls.close();
    expect(calls).toEqual(["listen 80 -> 1355", "close 80", "listen 80 -> 1355", "close 80"]);
    expect(shortUrls.publicPort()).toBe(null);
  });

  it("is not needed over HTTPS or when the proxy itself is on the port", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    expect(await shortUrls.sync({ ...on, proxyHttps: true })).toEqual({ state: "https" });
    expect(await shortUrls.sync({ ...on, proxyPort: 80 })).toEqual({ state: "proxy-on-port" });
    expect(calls).toEqual([]);
  });

  it("listens on the port it is given, for tests and other setups", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, port: 8081, log: () => {} });
    await shortUrls.sync(on);
    expect(calls).toEqual(["listen 8081 -> 1355"]);
    expect(shortUrls.publicPort()).toBe(8081);
  });

  it("runs syncs one after another, so two quick changes never listen twice", async () => {
    const { calls, forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    await Promise.all([shortUrls.sync(on), shortUrls.sync(on)]);
    expect(calls).toEqual(["listen 80 -> 1355"]);
  });

  it("tells watchers when the public port changes", async () => {
    const { forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {} });
    let changes = 0;
    shortUrls.onChange(() => {
      changes += 1;
    });
    await shortUrls.sync(on);
    await shortUrls.sync(on);
    await shortUrls.sync(DEFAULT_CONFIG);
    expect(changes).toBe(2);
  });
});

describe("ShortUrls.inspect", () => {
  it("answers from this process once it synced", async () => {
    const { forwarding } = fakeForwarding();
    const shortUrls = new ShortUrls({ forwarding, log: () => {}, reachesProxy: async () => false });
    await shortUrls.sync(on);
    expect(await shortUrls.inspect(on)).toEqual({ state: "listening", port: 80, target: 1355 });
  });

  it("asks port 80 from outside in a command that never synced, such as the doctor", async () => {
    const { forwarding } = fakeForwarding();
    const asked: number[] = [];
    const reaching = new ShortUrls({
      forwarding,
      log: () => {},
      reachesProxy: async (port) => {
        asked.push(port);
        return true;
      },
    });
    expect(await reaching.inspect(on)).toEqual({ state: "listening", port: 80, target: 1355 });
    expect(asked).toEqual([80]);
    const silent = new ShortUrls({ forwarding, log: () => {}, reachesProxy: async () => false });
    expect(await silent.inspect(on)).toBe(undefined);
    expect(await silent.inspect(DEFAULT_CONFIG)).toEqual({ state: "off" });
  });
});

describe("publicUrls", () => {
  const state: PortlessState = {
    proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
    portless: { installed: true, version: "1.0.0" },
    routes: [
      {
        hostname: "studio.localhost",
        name: "studio",
        port: 4949,
        kind: "alias",
        pid: null,
        registeredAt: null,
        url: "http://studio.localhost:1355",
        tunnels: [],
      },
    ],
    readAt: 1,
  };
  const registry = { readSnapshot: async () => state } as unknown as RouteRegistry;

  it("shows route URLs without the port while the forwarder listens", async () => {
    let port: number | null = 80;
    const wrapped = publicUrls(registry, () => port);
    expect((await wrapped.readSnapshot()).routes[0]?.url).toBe("http://studio.localhost");
    port = null;
    expect((await wrapped.readSnapshot()).routes[0]?.url).toBe("http://studio.localhost:1355");
  });
});
