import { DEFAULT_CONFIG, type StudioConfig } from "../core/config/studio-config.ts";
import type { DetectedPort } from "../core/ports/detected-port.ts";
import type { Result } from "../core/result.ts";
import { parsePort, parseRouteName } from "../core/routes/route-name.ts";
import type { ConfigStore } from "../server/application/config-store.ts";
import type { RouteRegistry } from "../server/application/route-registry.ts";
import type { CommandRunner } from "./command-runner.ts";
import type { Prompter } from "./prompter.ts";
import { STUDIO_ALIAS } from "./studio-alias.ts";

/** The part of the server's StudioServices that `init` uses. */
export type InitServices = {
  registry: RouteRegistry;
  configStore: ConfigStore;
  detectPorts(): Promise<DetectedPort[]>;
};

export type InitDeps = {
  services: InitServices;
  prompter: Prompter;
  run: CommandRunner;
  print: (line: string) => void;
  /** portless binary for `portless proxy start`: `PORTLESS_BIN` or `portless`. */
  portlessBin: string;
  /** Used to show folders as `~/...`. */
  homeDir: string;
  /** Sets Studio to start at login; the value is a message for the person. */
  installLoginService: () => Promise<Result<string, string>>;
};

export type InitSummary = {
  configPath: string;
  namesCreated: number;
  /** Where Studio will be: its portless name when it registers one, otherwise the plain URL. */
  url: string;
};

const MANUAL_INSTALL = "npm install -g portless";

/**
 * `portless-studio init`: checks portless, asks the basic settings, names the dev servers already
 * running, starts the proxy and optionally sets Studio to start at login.
 */
export async function runInit(deps: InitDeps): Promise<InitSummary> {
  const { services, prompter, print } = deps;
  print("Let's set up portless studio.\n");

  const portlessReady = await ensurePortless(deps);

  const current = await readConfig(services.configStore, print);
  const autoName = await prompter.confirm(
    "Turn on auto mode? Studio gives every new dev server a name automatically.",
  );
  const startAtLogin = await prompter.confirm("Start Studio when you log in?");
  const port = await askPort(prompter, current.port, print);
  const openBrowser = await prompter.confirm("Open the browser when Studio starts?");
  const config: StudioConfig = { ...current, autoName, port, openBrowser };
  const written = await services.configStore.write(config);
  print(
    written.ok
      ? `Saved your settings to ${shortenHome(services.configStore.path, deps.homeDir)}.\n`
      : `Could not save your settings: ${written.error.message}\n`,
  );

  let namesCreated = 0;
  if (portlessReady) {
    namesCreated = await nameDetectedPorts(deps);
    await offerProxyStart(deps);
  } else {
    print("Skipping port names and the proxy until portless is installed.\n");
  }

  if (startAtLogin) {
    const installed = await deps.installLoginService();
    print(installed.ok ? installed.value : `Could not set up start at login: ${installed.error}`);
  } else {
    print("Start Studio any time with: portless-studio");
  }

  const summary: InitSummary = {
    configPath: services.configStore.path,
    namesCreated,
    url: config.registerStudioAlias
      ? `https://${STUDIO_ALIAS}.localhost`
      : `http://127.0.0.1:${port}`,
  };
  print("");
  print("All set.");
  print(`  Config file    ${shortenHome(summary.configPath, deps.homeDir)}`);
  print(`  Names created  ${summary.namesCreated}`);
  print(`  Studio         ${summary.url}`);
  return summary;
}

/** True when portless is installed, possibly after installing it now. */
async function ensurePortless(deps: InitDeps): Promise<boolean> {
  const { registry } = deps.services;
  const { portless } = await registry.readSnapshot();
  if (portless.installed) {
    deps.print(`portless${portless.version ? ` ${portless.version}` : ""} is installed.\n`);
    return true;
  }

  if (!(await deps.prompter.confirm("portless is not installed. Install it now with npm?"))) {
    deps.print(`Install it later with: ${MANUAL_INSTALL}\n`);
    return false;
  }
  deps.print("Installing portless with npm. This can take a minute...");
  const installed = await registry.installPortless();
  if (!installed.ok) {
    deps.print(`The install failed:\n${installed.error.message}`);
    deps.print(`Install it by hand with: ${MANUAL_INSTALL}\n`);
    return false;
  }
  if (installed.value.version === null) {
    deps.print("npm finished, but the portless command still cannot be found.");
    deps.print(`Check your PATH, or install it by hand with: ${MANUAL_INSTALL}\n`);
    return false;
  }
  deps.print(`Installed portless ${installed.value.version}.\n`);
  return true;
}

async function readConfig(store: ConfigStore, print: InitDeps["print"]): Promise<StudioConfig> {
  const read = await store.read();
  if (read.ok) return read.value;
  print(`Your config file has a problem (${read.error.message}). Starting from the defaults.`);
  return DEFAULT_CONFIG;
}

async function askPort(
  prompter: Prompter,
  current: number,
  print: InitDeps["print"],
): Promise<number> {
  for (;;) {
    const answer = await prompter.ask("Port for Studio?", String(current));
    const port = parsePort(answer);
    if (port.ok) return port.value;
    print(`"${answer}" is not a port. Use a number from 1 to 65535.`);
  }
}

async function nameDetectedPorts(deps: InitDeps): Promise<number> {
  const { print } = deps;
  const ports = await deps.services.detectPorts();
  if (ports.length === 0) {
    print("No unnamed dev servers are running right now. New ones show up in Studio.\n");
    return 0;
  }

  print("Dev servers running without a name:\n");
  for (const line of portTable(ports, deps.homeDir)) print(`  ${line}`);
  print("");

  const nameable = ports.filter(
    (port): port is DetectedPort & { suggestedName: string } => port.suggestedName !== null,
  );
  if (nameable.length === 0) {
    print("Studio has no name to suggest for these. Name them from the dashboard.\n");
    return 0;
  }
  const question =
    nameable.length === 1 ? "Name this port?" : `Name these ${nameable.length} ports?`;
  if (!(await deps.prompter.confirm(question))) {
    print("");
    return 0;
  }

  let created = 0;
  for (const port of nameable) {
    const result = await createName(deps.services.registry, port.suggestedName, port.port);
    if (result.ok) {
      created += 1;
      print(`  ${result.value} -> port ${port.port}`);
    } else {
      print(`  port ${port.port}: ${result.error}`);
    }
  }
  print("");
  return created;
}

/** Creates the alias; a taken name is tried once more as `<name>-<port>`. */
async function createName(
  registry: RouteRegistry,
  name: string,
  port: number,
): Promise<Result<string, string>> {
  const first = await registry.createAlias(name, port, false);
  if (first.ok) return { ok: true, value: name };
  if (first.error.code !== "name_taken") return { ok: false, error: first.error.message };

  const fallback = parseRouteName(`${name}-${port}`);
  if (!fallback.ok) return { ok: false, error: first.error.message };
  const second = await registry.createAlias(fallback.value, port, false);
  return second.ok
    ? { ok: true, value: fallback.value }
    : { ok: false, error: second.error.message };
}

async function offerProxyStart(deps: InitDeps): Promise<void> {
  const { print } = deps;
  const { proxy } = await deps.services.registry.readSnapshot();
  if (proxy.running) {
    print("The portless proxy is running.\n");
    return;
  }

  print("The portless proxy is what serves the .localhost names in your browser.");
  print("Its first start asks for your password once: it listens on port 443 and trusts a");
  print("local certificate so the names work over HTTPS.");
  const command = `${deps.portlessBin} proxy start`;
  if (!(await deps.prompter.confirm("Start the portless proxy now?"))) {
    print(`Start it later with: ${command}\n`);
    return;
  }
  const started = await deps.run(deps.portlessBin, ["proxy", "start"], { inherit: true });
  print(
    started.exitCode === 0
      ? "The proxy is running.\n"
      : `The proxy did not start. Run it yourself with: ${command}\n`,
  );
}

function portTable(ports: DetectedPort[], homeDir: string): string[] {
  const rows = [
    ["PORT", "PROCESS", "FOLDER", "SUGGESTED NAME"],
    ...ports.map((port) => [
      String(port.port),
      port.processName,
      port.cwd ? shortenHome(port.cwd, homeDir) : "-",
      port.suggestedName ?? "-",
    ]),
  ];
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

/** `/home/dev/code/app` -> `~/code/app`. */
export function shortenHome(file: string, homeDir: string): string {
  if (homeDir === "") return file;
  if (file === homeDir) return "~";
  for (const separator of ["/", "\\"]) {
    if (file.startsWith(`${homeDir}${separator}`)) return `~${file.slice(homeDir.length)}`;
  }
  return file;
}
