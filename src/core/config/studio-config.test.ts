import { DEFAULT_CONFIG, parseConfig } from "./studio-config.ts";

describe("parseConfig", () => {
  it("starts an HTTP proxy on 1355 by default, which needs no sudo or certificate", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ startProxy: true, proxyPort: 1355, proxyHttps: false });
  });

  it("fills every missing field with its default", () => {
    expect(parseConfig({})).toEqual({ ok: true, value: DEFAULT_CONFIG });
  });

  it("keeps valid values, drops unknown fields and dedupes lists", () => {
    const result = parseConfig({ autoName: true, port: 5000, ignoredPorts: [9, 3, 9], extra: 1 });
    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_CONFIG, autoName: true, port: 5000, ignoredPorts: [3, 9] },
    });
  });

  it.each([
    [null, "The config must be a JSON object."],
    [[], "The config must be a JSON object."],
    [{ autoName: "yes" }, '"autoName" must be true or false.'],
    [{ port: 70000 }, '"port" must be a whole number from 1 to 65535.'],
    [{ proxyPort: 0 }, '"proxyPort" must be a whole number from 1 to 65535.'],
    [{ startProxy: 1 }, '"startProxy" must be true or false.'],
    [{ proxyHttps: "no" }, '"proxyHttps" must be true or false.'],
    [{ scanIntervalMs: 10 }, '"scanIntervalMs" must be a whole number of at least 1000.'],
    [{ ignoredPorts: ["80"] }, '"ignoredPorts" must be a list of port numbers.'],
    [{ ignoredProcesses: [1] }, '"ignoredProcesses" must be a list of process names.'],
  ])("rejects %j", (input, error) => {
    expect(parseConfig(input)).toEqual({ ok: false, error });
  });
});
