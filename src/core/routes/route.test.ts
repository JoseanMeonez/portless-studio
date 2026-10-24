import { nameFromHostname, routeUrl } from "./route.ts";

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
