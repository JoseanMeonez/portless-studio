import * as fs from "node:fs";
import * as path from "node:path";
import { err, ok, type Result } from "../core/result.ts";
import type { Route } from "../core/routes/route.ts";
import type { AutoNamedStore } from "../server/application/auto-named-store.ts";
import type { ProcessOwner } from "../server/application/process-control.ts";
import type { RouteRegistry } from "../server/application/route-registry.ts";
import { shortenHome } from "./init.ts";
import type { ServiceState } from "./login-service.ts";
import type { Prompter } from "./prompter.ts";
import { STUDIO_ALIAS } from "./studio-alias.ts";

export type UninstallDeps = {
  registry: RouteRegistry;
  /** The names auto mode gave; the only names uninstall removes besides `studio`. */
  autoNamed: AutoNamedStore;
  prompter: Prompter;
  print: (line: string) => void;
  /** Used to show folders as `~/...`. */
  homeDir: string;
  /** Folder of the config file. */
  configDir: string;
  configExists: boolean;
  service: {
    status(): Promise<ServiceState>;
    uninstall(): Promise<Result<{ file: string; removed: boolean }, string>>;
  };
  /** The proxy Studio started, from `proxy-started.json`; null when it never started one. */
  proxyRecord: { pid: number } | null;
  forgetProxyRecord: () => void;
  ownerOf: (pid: number) => Promise<ProcessOwner>;
  /** Deletes Studio's files in `configDir`, and the folder once it is empty. */
  removeConfig: () => Promise<Result<void, string>>;
};

export type UninstallSummary = {
  service: "removed" | "not-installed" | "failed" | "kept";
  namesRemoved: string[];
  proxy: "stopped" | "not-running" | "not-ours" | "other-user" | "failed" | "kept";
  config: "deleted" | "kept" | "failed" | "missing";
};

type ProxyPlan =
  | { kind: "stop"; pid: number }
  | { kind: "not-running" | "not-ours" | "other-user" };

/**
 * `portless-studio uninstall`: undoes what Studio set up on this machine. It removes the login
 * service, the names auto mode gave and the `studio` name, and stops the proxy only when Studio
 * started it and it runs as this user. Names a person or an agent gave, and portless itself, stay.
 * The settings folder is a separate question whose default is no.
 */
export async function runUninstall(deps: UninstallDeps): Promise<UninstallSummary> {
  const { print, registry } = deps;
  const service = await deps.service.status();
  const state = await registry.readSnapshot();
  const entries = await deps.autoNamed.read();
  const autoNames = entries
    .filter((entry) => state.routes.some((route) => isAlias(route, entry.name, entry.port)))
    .map((entry) => entry.name);
  const studio = state.routes.find(
    (route) => route.name === STUDIO_ALIAS && route.kind === "alias",
  );
  const proxy = await planProxy(deps, state.proxy.running);

  const steps: string[] = [];
  if (service.installed)
    steps.push(`Stop and remove the login service (${short(deps, service.file)})`);
  if (autoNames.length > 0) {
    steps.push(`Remove the names auto mode gave: ${autoNames.join(", ")}`);
  }
  if (studio) steps.push(`Remove the "${STUDIO_ALIAS}" name`);
  if (proxy.kind === "stop")
    steps.push(`Stop the portless proxy Studio started (pid ${proxy.pid})`);

  const summary: UninstallSummary = {
    service: service.installed ? "kept" : "not-installed",
    namesRemoved: [],
    proxy: proxy.kind === "stop" ? "kept" : proxy.kind,
    config: deps.configExists ? "kept" : "missing",
  };

  if (steps.length === 0) {
    print("Nothing else to undo: no login service, no names Studio gave, no proxy it started.");
  } else {
    print("portless-studio uninstall will:");
    for (const step of steps) print(`  - ${step}`);
    print("Names you or an agent gave, and portless itself, stay as they are.\n");
    if (!(await deps.prompter.confirm("Undo these?"))) {
      print("Nothing changed.");
      return { ...summary, proxy: "kept" };
    }

    if (service.installed) {
      const removed = await deps.service.uninstall();
      summary.service = removed.ok ? "removed" : "failed";
      if (!removed.ok) print(`Could not remove the login service: ${removed.error}`);
    }
    summary.namesRemoved = await removeNames(deps, autoNames, studio !== undefined);
    if (autoNames.length > 0) {
      const removed = new Set(summary.namesRemoved);
      await deps.autoNamed.write(entries.filter((entry) => !removed.has(entry.name)));
    }
    if (proxy.kind === "stop") {
      const stopped = await registry.stopProxy();
      summary.proxy = stopped.ok ? "stopped" : "failed";
      if (stopped.ok) deps.forgetProxyRecord();
      else print(`Could not stop the proxy: ${stopped.error.message}`);
    }
  }

  if (deps.configExists) {
    const where = short(deps, deps.configDir);
    if (await deps.prompter.confirm(`Also delete Studio's settings in ${where}?`, false)) {
      const removed = await deps.removeConfig();
      summary.config = removed.ok ? "deleted" : "failed";
      if (!removed.ok) print(`Could not delete the settings: ${removed.error}`);
    }
  }

  printSummary(deps, summary);
  return summary;
}

function isAlias(route: Route, name: string, port: number): boolean {
  return route.name === name && route.kind === "alias" && route.port === port;
}

/** Studio's proxy is the one whose pid it wrote down; another user's needs sudo to stop. */
async function planProxy(deps: UninstallDeps, running: boolean): Promise<ProxyPlan> {
  if (!running) return { kind: "not-running" };
  const pid = await deps.registry.proxyPid();
  if (pid === null || deps.proxyRecord?.pid !== pid) return { kind: "not-ours" };
  return (await deps.ownerOf(pid)) === "you" ? { kind: "stop", pid } : { kind: "other-user" };
}

async function removeNames(
  deps: UninstallDeps,
  autoNames: string[],
  studio: boolean,
): Promise<string[]> {
  const removed: string[] = [];
  for (const name of [
    ...autoNames,
    ...(studio && !autoNames.includes(STUDIO_ALIAS) ? [STUDIO_ALIAS] : []),
  ]) {
    const result = await deps.registry.removeAlias(name);
    if (result.ok) removed.push(name);
    else deps.print(`Could not remove ${name}: ${result.error.message}`);
  }
  return removed;
}

function printSummary(deps: UninstallDeps, summary: UninstallSummary): void {
  const { print } = deps;
  const service = {
    removed: "removed",
    "not-installed": "was not installed",
    failed: "could not be removed",
    kept: "kept",
  }[summary.service];
  const proxy = {
    stopped: "stopped",
    "not-running": "not running",
    "not-ours": "left running: Studio did not start it",
    "other-user": "left running: it runs as another user (stop it with: sudo portless proxy stop)",
    failed: "could not be stopped",
    kept: "kept",
  }[summary.proxy];
  const config = {
    deleted: "deleted",
    kept: `kept in ${short(deps, deps.configDir)}`,
    failed: "could not be deleted",
    missing: "none",
  }[summary.config];
  print("");
  print("Done.");
  print(`  Login service  ${service}`);
  print(
    `  Names removed  ${summary.namesRemoved.length > 0 ? summary.namesRemoved.join(", ") : "none"}`,
  );
  print(`  Proxy          ${proxy}`);
  print(`  Settings       ${config}`);
}

function short(deps: UninstallDeps, file: string): string {
  return shortenHome(file, deps.homeDir);
}

/**
 * Deletes the named files in `dir`, then the folder when nothing else is left in it, so a folder
 * shared with other files is never emptied by Studio.
 */
export function removeStudioFiles(dir: string, files: readonly string[]): Result<void, string> {
  try {
    for (const file of files) fs.rmSync(path.join(dir, file), { force: true });
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    return ok(undefined);
  } catch (error) {
    return err((error as Error).message);
  }
}
