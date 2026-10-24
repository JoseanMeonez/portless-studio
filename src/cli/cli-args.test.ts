import { DEFAULT_PORT, parseCliArgs } from "./cli-args.ts";

describe("parseCliArgs", () => {
  it("starts on the default port, opening the browser and registering the alias", () => {
    expect(parseCliArgs([])).toEqual({
      ok: true,
      value: { command: "start", port: DEFAULT_PORT, open: true, register: true },
    });
  });

  it("reads --port, --no-open and --no-register", () => {
    expect(parseCliArgs(["--port", "0", "--no-open", "--no-register"])).toEqual({
      ok: true,
      value: { command: "start", port: 0, open: false, register: false },
    });
  });

  it("reads --help and --version", () => {
    expect(parseCliArgs(["-h"])).toEqual({ ok: true, value: { command: "help" } });
    expect(parseCliArgs(["--version"])).toEqual({ ok: true, value: { command: "version" } });
  });

  it("rejects a bad port and unknown flags", () => {
    expect(parseCliArgs(["--port", "99999"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["--port", "abc"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["--nope"])).toMatchObject({ ok: false });
  });
});
