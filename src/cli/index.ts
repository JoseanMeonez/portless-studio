#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PATHS, type Snapshot } from "../core/api/contract.ts";
import { DEFAULT_CONFIG, type StudioConfig } from "../core/config/studio-config.ts";
import type { Result } from "../core/result.ts";
import type { ConfigStore } from "../server/application/config-store.ts";
import {
  createStudioServices,
  createUninstallServices,
  type RunningServer,
  startServer,
} from "../server/main.ts";
import {
  type CliOptions,
  HELP,
  parseCliArgs,
  resolveStartSettings,
  type ServiceAction,
  type StartOverrides,
} from "./cli-args.ts";
import { runCommand } from "./command-runner.ts";
import { editConfig, printConfig, printConfigJson } from "./config-command.ts";
import { runDoctorCommand } from "./doctor-command.ts";
import { runInit } from "./init.ts";
import { runListCommand } from "./list-command.ts";
import {
  installService,
  resolveServiceEntry,
  type ServiceEnv,
  serviceStatus,
  uninstallService,
} from "./login-service.ts";
import { createMcpServer, serveStdio } from "./mcp/mcp-server.ts";
import { createStudioClient, resolveStudioUrl, type StudioClient } from "./mcp/studio-client.ts";
import { AGENT_INSTRUCTIONS, createStudioTools } from "./mcp/studio-tools.ts";
import { openBrowser } from "./open-browser.ts";
import { createDefaultsPrompter, createTerminalPrompter } from "./prompter.ts";
import {
  isListening,
  registerStudioAlias,
  type StudioAlias,
  unregisterStudioAlias,
} from "./studio-alias.ts";
import { createStudioServiceControl } from "./studio-service-control.ts";
import { removeStudioFiles, runUninstall } from "./uninstall.ts";

const print = (line: string) => console.log(line);

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}\n\n${HELP}`);
    process.exit(1);
  }
  const options: CliOptions = parsed.value;
  switch (options.command) {
    case "help":
      print(HELP);
      return;
    case "version":
      print(readVersion());
      return;
    case "init":
      await init(options.yes);
      return;
    case "uninstall":
      await uninstall(options.yes);
      return;
    case "service":
      await service(options.action);
      return;
    case "config": {
      const { configStore } = createStudioServices();
      if (options.json) process.exitCode = await printConfigJson(configStore, print);
      else if (options.edit) await editConfig(configStore, process.env.EDITOR, runCommand, print);
      else await printConfig(configStore, print);
      return;
    }
    case "doctor":
      await doctor(options.json);
      return;
    case "list":
      await list(options.json);
      return;
    case "mcp":
      await mcp();
      return;
    case "start":
      await start(options.overrides);
      return;
  }
}

/** Talks to the Studio named by `PORTLESS_STUDIO_URL`, or the one on the configured port. */
async function studioClient(): Promise<StudioClient> {
  const config = await readConfig(createStudioServices().configStore);
  const url = resolveStudioUrl(process.env.PORTLESS_STUDIO_URL, config.port);
  if (!url.ok) {
    console.error(`Error: ${url.error}`);
    process.exit(1);
  }
  return createStudioClient(url.value);
}

async function list(json: boolean): Promise<void> {
  const client = await studioClient();
  const code = await runListCommand({
    json,
    print,
    readFromStudio: async () => {
      const snapshot = await client.read(API_PATHS.snapshot);
      return snapshot.ok ? { ok: true, value: snapshot.value as Snapshot } : snapshot;
    },
    readLocally: async () => {
      const services = createStudioServices();
      const state = await services.registry.readSnapshot();
      return { proxy: state.proxy, routes: state.routes, detected: await services.detectPorts() };
    },
  });
  // The local fallback may leave scan timers behind; the list is all this command does.
  process.exit(code);
}

/** stdout carries only protocol messages; warnings go to stderr through `console.error`. */
async function mcp(): Promise<void> {
  const client = await studioClient();
  const server = createMcpServer({
    name: "portless-studio",
    version: readVersion(),
    instructions: AGENT_INSTRUCTIONS,
    tools: createStudioTools(client),
  });
  console.error(`portless-studio mcp: talking to Studio at ${client.baseUrl}`);
  await serveStdio(server, process.stdin, process.stdout);
  process.exit(0);
}

async function doctor(json: boolean): Promise<void> {
  const env = await serviceEnv();
  const studioService = createStudioServiceControl({
    env: env.ok ? env.value : null,
    exitSelf: async () => {},
  });
  const services = createStudioServices({ studioService });
  const code = await runDoctorCommand(() => services.doctor.check(), print, { json });
  // The services may hold timers or watchers; the report is all doctor does.
  process.exit(code);
}

async function start(overrides: StartOverrides): Promise<void> {
  const config = await readConfig(createStudioServices().configStore);
  const settings = resolveStartSettings(overrides, config);
  // Replaced by the real shutdown once the server runs; the page can ask Studio to stop itself.
  let shutdown: () => Promise<void> = async () => process.exit(0);
  const env = await serviceEnv();
  const studioService = createStudioServiceControl({
    env: env.ok ? env.value : null,
    exitSelf: () => shutdown(),
  });
  const services = createStudioServices({ studioPort: settings.port, studioService });

  const webDir = resolveWebDir();
  let server: RunningServer;
  try {
    server = await startServer({ port: settings.port, webDir, services });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(
      code === "EADDRINUSE"
        ? `Error: port ${settings.port} is in use. Pick another one with --port or in the config.`
        : `Error: could not start the server: ${(error as Error).message}`,
    );
    process.exit(1);
  }

  // The runtime starts the proxy right after the server; wait for it so the printed URL is real.
  await waitForProxy(server.registry);
  const alias: StudioAlias = settings.register
    ? await registerStudioAlias(server.registry, server.port)
    : { url: null, owned: false };

  print("portless-studio is running");
  if (alias.url) print(`  ${alias.url}`);
  print(`  ${server.url}`);
  if (alias.note) print(`  (no "studio" alias: ${alias.note})`);
  if (!webDir) print("  API only: the UI runs through `pnpm dev:web`.");

  if (settings.open && webDir) openBrowser(alias.url ?? server.url);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (alias.owned) await unregisterStudioAlias(server.registry, server.port).catch(() => {});
    await server.close();
    process.exit(0);
  };
  shutdown = stop;
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function init(yes: boolean): Promise<void> {
  const services = createStudioServices();
  const prompter = yes
    ? createDefaultsPrompter(print)
    : createTerminalPrompter(process.stdin, process.stdout);
  try {
    await runInit({
      services,
      prompter,
      run: runCommand,
      print,
      portlessBin: process.env.PORTLESS_BIN || "portless",
      homeDir: os.homedir(),
      installLoginService: async () => {
        const env = await serviceEnv();
        if (!env.ok) return env;
        return describeInstall(await installService(env.value), env.value);
      },
    });
  } finally {
    prompter.close();
  }
  // The services may hold timers or watchers; init is done once the summary is printed.
  process.exit(0);
}

async function uninstall(yes: boolean): Promise<void> {
  const env = await serviceEnv();
  if (!env.ok) {
    console.error(`Error: ${env.error}`);
    process.exit(1);
  }
  const { registry } = createStudioServices();
  const files = createUninstallServices();
  const prompter = yes
    ? createDefaultsPrompter(print)
    : createTerminalPrompter(process.stdin, process.stdout);
  try {
    await runUninstall({
      registry,
      autoNamed: files.autoNamed,
      prompter,
      print,
      homeDir: os.homedir(),
      configDir: files.configDir,
      configExists: files.configExists,
      service: {
        status: () => serviceStatus(env.value),
        uninstall: () => uninstallService(env.value),
      },
      proxyRecord: files.proxyRecord,
      forgetProxyRecord: files.forgetProxyRecord,
      ownerOf: files.ownerOf,
      removeConfig: async () => removeStudioFiles(files.configDir, files.studioFiles),
    });
  } finally {
    prompter.close();
  }
  process.exit(0);
}

async function service(action: ServiceAction): Promise<void> {
  const env = await serviceEnv();
  if (!env.ok) {
    console.error(`Error: ${env.error}`);
    process.exit(1);
  }
  if (action === "install") {
    const described = describeInstall(await installService(env.value), env.value);
    if (!described.ok) {
      console.error(`Error: ${described.error}`);
      process.exit(1);
    }
    print(described.value);
    return;
  }
  if (action === "uninstall") {
    const removed = await uninstallService(env.value);
    if (!removed.ok) {
      console.error(`Error: ${removed.error}`);
      process.exit(1);
    }
    print(
      removed.value.removed
        ? `Studio no longer starts at login. Removed ${removed.value.file}.`
        : "Studio was not set to start at login.",
    );
    return;
  }
  const state = await serviceStatus(env.value);
  print(`Start at login: ${state.installed ? "installed" : "not installed"} (${state.file})`);
  print(`Running:        ${state.running ? "yes" : "no"}`);
}

function describeInstall(
  installed: Result<{ file: string }, string>,
  env: ServiceEnv,
): Result<string, string> {
  if (!installed.ok) return installed;
  const lines = [`Studio will start when you log in. Service file: ${installed.value.file}`];
  if (env.platform === "win32") lines.push("Start it now with: portless-studio");
  if (env.entryPath.includes(`${path.sep}_npx${path.sep}`)) {
    lines.push(
      "Note: this runs from the npx cache, which npm can clear. Install Studio globally with " +
        "`npm install -g portless-studio` and run `portless-studio service install` again.",
    );
  }
  return { ok: true, value: lines.join("\n") };
}

async function serviceEnv(): Promise<Result<ServiceEnv, string>> {
  const entry = resolveServiceEntry(import.meta.url);
  if (!entry.ok) return entry;
  const config = await readConfig(createStudioServices().configStore);
  return {
    ok: true,
    value: {
      platform: process.platform,
      homeDir: os.homedir(),
      appDataDir: process.env.APPDATA ?? null,
      uid: typeof process.getuid === "function" ? process.getuid() : null,
      nodePath: process.execPath,
      entryPath: entry.value,
      variables: serviceVariables(),
      run: runCommand,
      isRunning: () => isListening(config.port),
    },
  };
}

/**
 * Login sessions start services with a short PATH. Passing this one, with node's own folder first,
 * lets Studio find `portless` and `npm` where they were installed (nvm, Homebrew, npm prefix).
 */
function serviceVariables(): Record<string, string> {
  const nodeDir = path.dirname(process.execPath);
  const current = process.env.PATH ?? "";
  const variables: Record<string, string> = {
    PATH: current.split(path.delimiter).includes(nodeDir)
      ? current
      : [nodeDir, current].filter(Boolean).join(path.delimiter),
  };
  for (const name of ["PORTLESS_STATE_DIR", "PORTLESS_BIN"]) {
    const value = process.env[name];
    if (value) variables[name] = value;
  }
  return variables;
}

async function readConfig(store: ConfigStore): Promise<StudioConfig> {
  const read = await store.read();
  if (read.ok) return read.value;
  console.error(`Warning: ignoring ${store.path}: ${read.error.message}`);
  return DEFAULT_CONFIG;
}

/**
 * The built app sits next to the built CLI (`dist/web` beside `dist/cli`). Running the TypeScript
 * source means development, where Vite serves the UI.
 */
function resolveWebDir(): string | undefined {
  if (import.meta.url.endsWith(".ts")) return undefined;
  const dir = fileURLToPath(new URL("../web/", import.meta.url));
  return fs.existsSync(path.join(dir, "index.html")) ? dir : undefined;
}

function readVersion(): string {
  const file = new URL("../../package.json", import.meta.url);
  const pkg: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, "version") : undefined;
  return typeof version === "string" ? version : "unknown";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function waitForProxy(
  registry: { readSnapshot(): Promise<{ proxy: { running: boolean } }> },
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await registry.readSnapshot()).proxy.running) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
