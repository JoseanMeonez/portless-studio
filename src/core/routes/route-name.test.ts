import { parsePort, parseRouteName } from "./route-name.ts";

describe("parseRouteName", () => {
  it("normalizes case and spaces into a hostname label", () => {
    expect(parseRouteName("  My App ")).toEqual({ ok: true, value: "my-app" });
  });

  it("keeps subdomains", () => {
    expect(parseRouteName("api.acme")).toEqual({ ok: true, value: "api.acme" });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["-api", "invalid_label"],
    ["api-", "invalid_label"],
    ["api..acme", "invalid_label"],
    ["api_acme", "invalid_label"],
    [`${"a".repeat(64)}`, "invalid_label"],
  ])("rejects %j as %s", (input, error) => {
    expect(parseRouteName(input)).toEqual({ ok: false, error });
  });
});

describe("parsePort", () => {
  it.each([1, 3000, 65535, "8787"])("accepts %j", (input) => {
    expect(parsePort(input).ok).toBe(true);
  });

  it.each([0, 65536, 3.5, "abc", ""])("rejects %j", (input) => {
    expect(parsePort(input)).toEqual({ ok: false, error: "invalid_port" });
  });
});
