import { DEFAULT_CONFIG } from "../core/config/studio-config.ts";
import { DEFAULT_PORT, parseCliArgs, resolveStartSettings } from "./cli-args.ts";

describe("parseCliArgs", () => {
  it("starts the server with no subcommand and no overrides", () => {
    expect(parseCliArgs([])).toEqual({ ok: true, value: { command: "start", overrides: {} } });
  });

  it("reads --port, --no-open and --no-register as overrides", () => {
    expect(parseCliArgs(["--port", "0", "--no-open", "--no-register"])).toEqual({
      ok: true,
      value: { command: "start", overrides: { port: 0, open: false, register: false } },
    });
    expect(parseCliArgs(["--open", "--register"])).toEqual({
      ok: true,
      value: { command: "start", overrides: { open: true, register: true } },
    });
  });

  it("reads --help and --version, also after a subcommand", () => {
    expect(parseCliArgs(["-h"])).toEqual({ ok: true, value: { command: "help" } });
    expect(parseCliArgs(["--version"])).toEqual({ ok: true, value: { command: "version" } });
    expect(parseCliArgs(["init", "--help"])).toEqual({ ok: true, value: { command: "help" } });
  });

  it("rejects a bad port and unknown flags", () => {
    expect(parseCliArgs(["--port", "99999"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["--port", "abc"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["--nope"])).toMatchObject({ ok: false });
  });

  it("reads init and its --yes flag", () => {
    expect(parseCliArgs(["init"])).toEqual({ ok: true, value: { command: "init", yes: false } });
    expect(parseCliArgs(["init", "--yes"])).toEqual({
      ok: true,
      value: { command: "init", yes: true },
    });
    expect(parseCliArgs(["init", "-y"])).toEqual({
      ok: true,
      value: { command: "init", yes: true },
    });
    expect(parseCliArgs(["init", "--port", "1"])).toMatchObject({ ok: false });
  });

  it("reads service install, uninstall and status", () => {
    for (const action of ["install", "uninstall", "status"] as const) {
      expect(parseCliArgs(["service", action])).toEqual({
        ok: true,
        value: { command: "service", action },
      });
    }
    expect(parseCliArgs(["service"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["service", "restart"])).toMatchObject({ ok: false });
  });

  it("reads config and config --edit", () => {
    expect(parseCliArgs(["config"])).toEqual({
      ok: true,
      value: { command: "config", edit: false },
    });
    expect(parseCliArgs(["config", "--edit"])).toEqual({
      ok: true,
      value: { command: "config", edit: true },
    });
  });

  it("rejects an unknown subcommand", () => {
    expect(parseCliArgs(["deploy"])).toEqual({
      ok: false,
      error: 'Unknown command "deploy".',
    });
  });
});

describe("resolveStartSettings", () => {
  it("takes the port and switches from the config when no flag is given", () => {
    const config = {
      ...DEFAULT_CONFIG,
      port: 5000,
      openBrowser: false,
      registerStudioAlias: false,
    };
    expect(resolveStartSettings({}, config)).toEqual({ port: 5000, open: false, register: false });
  });

  it("lets flags win over the config", () => {
    const config = { ...DEFAULT_CONFIG, port: 5000, openBrowser: false, registerStudioAlias: true };
    expect(resolveStartSettings({ port: 0, open: true, register: false }, config)).toEqual({
      port: 0,
      open: true,
      register: false,
    });
  });

  it("matches the config default port", () => {
    expect(DEFAULT_PORT).toBe(DEFAULT_CONFIG.port);
  });
});
