import { DEFAULT_CONFIG } from "../core/config/studio-config.ts";
import { DEFAULT_PORT, HELP, parseCliArgs, resolveStartSettings } from "./cli-args.ts";

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

  it("lets the last of --open and --no-open win", () => {
    expect(parseCliArgs(["--open", "--no-open"])).toMatchObject({
      value: { overrides: { open: false } },
    });
    expect(parseCliArgs(["--no-open", "--open"])).toMatchObject({
      value: { overrides: { open: true } },
    });
  });

  it("reads --no-<flag> for every boolean flag and nothing else", () => {
    expect(parseCliArgs(["doctor", "--no-json"])).toEqual({
      ok: true,
      value: { command: "doctor", json: false },
    });
    expect(parseCliArgs(["--no-port"])).toEqual({ ok: false, error: "Unknown option '--no-port'" });
    expect(parseCliArgs(["--no-open=1"])).toEqual({
      ok: false,
      error: "Option '--open' does not take an argument",
    });
  });

  it("leaves --no-<flag> after -- to the command", () => {
    expect(parseCliArgs(["run", "--", "pnpm", "--no-open"])).toMatchObject({
      value: { command: "run", argv: ["pnpm", "--no-open"] },
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

  it("reads doctor and refuses flags it does not take", () => {
    expect(parseCliArgs(["doctor"])).toEqual({
      ok: true,
      value: { command: "doctor", json: false },
    });
    expect(parseCliArgs(["doctor", "--port", "1"])).toMatchObject({ ok: false });
  });

  it("reads uninstall and its --yes flag, and lists it in the help", () => {
    expect(parseCliArgs(["uninstall"])).toEqual({
      ok: true,
      value: { command: "uninstall", yes: false },
    });
    expect(parseCliArgs(["uninstall", "-y"])).toEqual({
      ok: true,
      value: { command: "uninstall", yes: true },
    });
    expect(parseCliArgs(["uninstall", "--json"])).toMatchObject({ ok: false });
    expect(HELP).toContain("portless-studio uninstall [--yes]");
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
      value: { command: "config", edit: false, json: false },
    });
    expect(parseCliArgs(["config", "--edit"])).toEqual({
      ok: true,
      value: { command: "config", edit: true, json: false },
    });
  });

  it("reads --json on doctor, config and list", () => {
    expect(parseCliArgs(["doctor", "--json"])).toEqual({
      ok: true,
      value: { command: "doctor", json: true },
    });
    expect(parseCliArgs(["config", "--json"])).toEqual({
      ok: true,
      value: { command: "config", edit: false, json: true },
    });
    expect(parseCliArgs(["config", "--edit", "--json"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["list"])).toEqual({ ok: true, value: { command: "list", json: false } });
    expect(parseCliArgs(["list", "--json"])).toEqual({
      ok: true,
      value: { command: "list", json: true },
    });
    expect(parseCliArgs(["init", "--json"])).toMatchObject({ ok: false });
  });

  it("reads env with its flags and route names", () => {
    expect(parseCliArgs(["env"])).toEqual({
      ok: true,
      value: { command: "env", json: false, direct: false, prefix: null, strip: null, names: [] },
    });
    expect(
      parseCliArgs(["env", "--prefix", "VITE_", "--strip", "acme", "--direct", "--json", "acme"]),
    ).toEqual({
      ok: true,
      value: {
        command: "env",
        json: true,
        direct: true,
        prefix: "VITE_",
        strip: "acme",
        names: ["acme"],
      },
    });
    expect(parseCliArgs(["env", "--yes"])).toMatchObject({ ok: false });
    expect(HELP).toContain("portless-studio env [--prefix P] [--strip S] [--direct] [--json]");
  });

  it("reads mcp and refuses flags it does not take", () => {
    expect(parseCliArgs(["mcp"])).toEqual({ ok: true, value: { command: "mcp" } });
    expect(parseCliArgs(["mcp", "--json"])).toMatchObject({ ok: false });
  });

  it("lists mcp and list in the help", () => {
    expect(HELP).toContain("portless-studio mcp");
    expect(HELP).toContain("portless-studio list [--json]");
    expect(HELP).toContain("PORTLESS_STUDIO_URL");
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
