import { createServer as createHttpServer } from "node:http";
import type { AddressInfo, Server } from "node:net";
import type { Snapshot } from "../core/api/contract.ts";
import { err, ok } from "../core/result.ts";
import type { Route } from "../core/routes/route.ts";
import type { RouteRegistry } from "../server/application/route-registry.ts";
import { registerStudioAlias, unregisterStudioAlias } from "./studio-alias.ts";

function studio(port: number, kind: Route["kind"] = "alias"): Route {
  return {
    hostname: "studio.localhost",
    name: "studio",
    port,
    kind,
    pid: kind === "alias" ? null : 1,
    registeredAt: null,
    url: "http://studio.localhost:1355",
    tunnels: [],
  };
}

function registry(initial: Route[], fail = false) {
  let routes = initial;
  const calls: string[] = [];
  const fake: RouteRegistry = {
    readSnapshot: async (): Promise<Snapshot> => ({
      proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
      routes,
      portless: { installed: true, version: "1.0.0" },
      detected: [],
      autoName: false,
      readAt: 0,
    }),
    installPortless: async () => ok({ version: "1.0.0", output: "" }),
    startProxy: async () => ok(undefined),
    stopProxy: async () => ok(undefined),
    proxyPid: async () => null,
    watch: () => () => {},
    createAlias: async (name, port, force) => {
      calls.push(`create ${name} ${port} ${force}`);
      if (fail) return err({ code: "portless_unavailable", message: "no portless" });
      routes = [studio(port)];
      return ok(undefined);
    },
    removeAlias: async (name) => {
      calls.push(`remove ${name}`);
      routes = [];
      return ok(undefined);
    },
  };
  return { fake, calls };
}

let listener: Server | undefined;

afterEach(async () => {
  await new Promise((resolve) => (listener ? listener.close(resolve) : resolve(undefined)));
  listener = undefined;
});

describe("registerStudioAlias", () => {
  it("creates the alias and owns it", async () => {
    const { fake, calls } = registry([]);
    expect(await registerStudioAlias(fake, 4321)).toEqual({
      url: "http://studio.localhost:1355",
      owned: true,
    });
    expect(calls).toEqual(["create studio 4321 false"]);
  });

  it("skips when studio already points to this port", async () => {
    const { fake, calls } = registry([studio(4321)]);
    expect(await registerStudioAlias(fake, 4321)).toMatchObject({ owned: false });
    expect(calls).toEqual([]);
  });

  it("leaves an alias alone while another Studio answers on its port", async () => {
    const { fake, calls } = registry([studio(5000)]);
    const isStudioAt = async (port: number) => port === 5000;
    expect(await registerStudioAlias(fake, 4321, { isStudioAt })).toMatchObject({
      url: null,
      owned: false,
    });
    expect(calls).toEqual([]);
  });

  it("replaces an alias whose port now belongs to a program that is not a Studio", async () => {
    // macOS ControlCenter, for one, takes port 5000 after a Studio there stopped.
    const program = createHttpServer((_req, res) => res.writeHead(403).end());
    listener = program.listen(0, "127.0.0.1");
    await new Promise((resolve) => listener?.once("listening", resolve));
    const busy = (listener.address() as AddressInfo).port;
    const { fake, calls } = registry([studio(busy)]);
    expect(await registerStudioAlias(fake, 4321)).toMatchObject({ owned: true });
    program.closeAllConnections();
    expect(calls).toEqual(["create studio 4321 true"]);
  });

  it("replaces a stale alias whose port is closed", async () => {
    const { fake, calls } = registry([studio(1)]);
    expect(await registerStudioAlias(fake, 4321)).toMatchObject({ owned: true });
    expect(calls).toEqual(["create studio 4321 true"]);
  });

  it("never fails startup when portless is missing", async () => {
    const { fake } = registry([], true);
    expect(await registerStudioAlias(fake, 4321)).toEqual({
      url: null,
      owned: false,
      note: "no portless",
    });
  });
});

describe("unregisterStudioAlias", () => {
  it("removes the alias only while it points to this port", async () => {
    const other = registry([studio(9999)]);
    await unregisterStudioAlias(other.fake, 4321);
    expect(other.calls).toEqual([]);

    const own = registry([studio(4321)]);
    await unregisterStudioAlias(own.fake, 4321);
    expect(own.calls).toEqual(["remove studio"]);
  });
});
