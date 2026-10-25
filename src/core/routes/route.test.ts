import {
  nameFromHostname,
  type ProxyStatus,
  type Route,
  routeUrl,
  withPublicPort,
} from "./route.ts";

describe("nameFromHostname", () => {
  it("strips the matching TLD", () => {
    expect(nameFromHostname("api.acme.localhost", ["localhost"])).toBe("api.acme");
  });

  it("returns the hostname when no TLD matches", () => {
    expect(nameFromHostname("api.acme.test", ["localhost"])).toBe("api.acme.test");
  });
});

describe("routeUrl", () => {
  it("omits the default HTTPS port", () => {
    expect(routeUrl("web.localhost", { port: 443, https: true })).toBe("https://web.localhost");
  });

  it("keeps a custom port", () => {
    expect(routeUrl("web.localhost", { port: 1355, https: false })).toBe(
      "http://web.localhost:1355",
    );
  });
});

describe("routeUrl with a public port", () => {
  it("uses the public port instead of the proxy port, and drops it when it is 80", () => {
    const proxy = { port: 1355, https: false, publicPort: 80 };
    expect(routeUrl("web.localhost", proxy)).toBe("http://web.localhost");
    expect(routeUrl("web.localhost", { ...proxy, publicPort: 8080 })).toBe(
      "http://web.localhost:8080",
    );
  });

  it("keeps the proxy port when the public port is null or absent", () => {
    expect(routeUrl("web.localhost", { port: 1355, https: false, publicPort: null })).toBe(
      "http://web.localhost:1355",
    );
  });
});

describe("withPublicPort", () => {
  const proxy: ProxyStatus = { running: true, port: 1355, https: false, tlds: ["localhost"] };
  const route: Route = {
    hostname: "web.acme.localhost",
    name: "web.acme",
    port: 5173,
    kind: "alias",
    pid: null,
    registeredAt: null,
    url: "http://web.acme.localhost:1355",
    tunnels: [],
  };

  it("rewrites every route URL and records the public port on the proxy", () => {
    const state = withPublicPort({ proxy, routes: [route] }, 80);
    expect(state.proxy.publicPort).toBe(80);
    expect(state.routes[0]?.url).toBe("http://web.acme.localhost");
  });

  it("leaves the state as it is without a public port", () => {
    const state = { proxy, routes: [route] };
    expect(withPublicPort(state, null)).toBe(state);
  });
});
