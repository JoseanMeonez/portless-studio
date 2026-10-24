import { hasToken, isAllowedHost, isSameOrigin } from "./request-guards.ts";

describe("isAllowedHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.1:4321",
    "localhost",
    "LOCALHOST:5173",
    "[::1]:4321",
    "studio.localhost",
    "studio.localhost:1355",
  ])("accepts %s", (host) => {
    expect(isAllowedHost(host)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "evil.com",
    "localhost.evil.com",
    "127.0.0.2",
    "10.0.0.1:4321",
    "a b",
    "evil.com:80@x.localhost",
    "127.1",
    "2130706433",
  ])("rejects %s", (host) => {
    expect(isAllowedHost(host)).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("accepts a request without Origin", () => {
    expect(isSameOrigin(undefined, "127.0.0.1:4321")).toBe(true);
  });

  it("accepts an Origin that matches the Host", () => {
    expect(isSameOrigin("http://127.0.0.1:4321", "127.0.0.1:4321")).toBe(true);
    expect(isSameOrigin("https://studio.localhost", "studio.localhost")).toBe(true);
  });

  it("rejects a different origin, a different port and the null origin", () => {
    expect(isSameOrigin("http://evil.com", "127.0.0.1:4321")).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:9999", "127.0.0.1:4321")).toBe(false);
    expect(isSameOrigin("null", "127.0.0.1:4321")).toBe(false);
  });
});

describe("hasToken", () => {
  it("compares the header with the token", () => {
    expect(hasToken("abc", "abc")).toBe(true);
    expect(hasToken("abd", "abc")).toBe(false);
    expect(hasToken("ab", "abc")).toBe(false);
    expect(hasToken(undefined, "abc")).toBe(false);
  });
});
