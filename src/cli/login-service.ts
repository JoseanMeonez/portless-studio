import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../core/result.ts";
import type { CommandRunner } from "./command-runner.ts";

/** Everything the login service touches on this machine, injectable so tests use a temp dir. */
export type ServiceEnv = {
  platform: NodeJS.Platform;
  homeDir: string;
  /** `%APPDATA%` on Windows; null elsewhere. */
  appDataDir: string | null;
  /** User id for `launchctl` on macOS; null where there is none. */
  uid: number | null;
  /** Absolute path of the node binary running this CLI. */
  nodePath: string;
  /** Absolute path of the built CLI entry, `dist/cli/index.js`. */
  entryPath: string;
  /** Environment the service starts with, such as PATH, so it can find `portless` and `npm`. */
  variables: Record<string, string>;
  run: CommandRunner;
  /** Windows has no service manager to ask, so status asks whether Studio answers instead. */
  isRunning: () => Promise<boolean>;
};

export type ServiceState = { file: string; installed: boolean; running: boolean };

const SYSTEMD_UNIT = "portless-studio.service";
const LAUNCHD_LABEL = "dev.portless-studio";

/** Where the service definition lives on this platform. */
export function serviceFile(env: ServiceEnv): string {
  if (env.platform === "darwin") {
    return path.join(env.homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  }
  if (env.platform === "win32") {
    const appData = env.appDataDir ?? path.join(env.homeDir, "AppData", "Roaming");
    return path.join(
      appData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      "portless-studio.cmd",
    );
  }
  return path.join(env.homeDir, ".config", "systemd", "user", SYSTEMD_UNIT);
}

/**
 * The built entry this CLI runs from. Running the TypeScript source has no stable file a login
 * service could start, so it is refused.
 */
export function resolveServiceEntry(moduleUrl: string): Result<string, string> {
  if (moduleUrl.endsWith(".ts")) {
    return err(
      "Studio is running from its TypeScript source. Build it first with `pnpm build`, then run " +
        "`node dist/cli/index.js service install`.",
    );
  }
  return ok(fileURLToPath(moduleUrl));
}

export async function installService(env: ServiceEnv): Promise<Result<{ file: string }, string>> {
  const file = serviceFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (env.platform === "darwin") {
    fs.writeFileSync(file, launchAgent(env));
    const domain = env.uid === null ? null : `gui/${env.uid}`;
    const bootstrapped = domain
      ? await env.run("launchctl", ["bootstrap", domain, file])
      : { exitCode: 1, output: "", missing: false };
    if (bootstrapped.exitCode === 0) return ok({ file });
    // `load -w` is the older interface; some macOS setups still need it.
    const loaded = await env.run("launchctl", ["load", "-w", file]);
    if (loaded.exitCode === 0) return ok({ file });
    return err(`launchctl could not load ${file}: ${loaded.output || bootstrapped.output}`);
  }

  if (env.platform === "win32") {
    fs.writeFileSync(file, startupScript(env));
    return ok({ file });
  }

  fs.writeFileSync(file, systemdUnit(env));
  for (const args of [
    ["--user", "daemon-reload"],
    ["--user", "enable", "--now", SYSTEMD_UNIT],
  ]) {
    const result = await env.run("systemctl", args);
    if (result.exitCode !== 0) {
      return err(`\`systemctl ${args.join(" ")}\` failed: ${result.output || "no output"}`);
    }
  }
  return ok({ file });
}

export async function uninstallService(
  env: ServiceEnv,
): Promise<Result<{ file: string; removed: boolean }, string>> {
  const file = serviceFile(env);
  if (!fs.existsSync(file)) return ok({ file, removed: false });

  if (env.platform === "darwin") {
    const bootedOut =
      env.uid === null
        ? null
        : await env.run("launchctl", ["bootout", `gui/${env.uid}/${LAUNCHD_LABEL}`]);
    if (bootedOut?.exitCode !== 0) await env.run("launchctl", ["unload", "-w", file]);
    fs.rmSync(file, { force: true });
    return ok({ file, removed: true });
  }

  if (env.platform === "win32") {
    fs.rmSync(file, { force: true });
    return ok({ file, removed: true });
  }

  // A unit that is already stopped or disabled is fine; the file goes either way.
  await env.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  fs.rmSync(file, { force: true });
  await env.run("systemctl", ["--user", "daemon-reload"]);
  return ok({ file, removed: true });
}

export async function serviceStatus(env: ServiceEnv): Promise<ServiceState> {
  const file = serviceFile(env);
  const installed = fs.existsSync(file);
  if (!installed) return { file, installed, running: false };

  if (env.platform === "darwin") {
    if (env.uid === null) return { file, installed, running: false };
    const printed = await env.run("launchctl", ["print", `gui/${env.uid}/${LAUNCHD_LABEL}`]);
    return {
      file,
      installed,
      running: printed.exitCode === 0 && /state = running/.test(printed.output),
    };
  }
  if (env.platform === "win32") return { file, installed, running: await env.isRunning() };

  const active = await env.run("systemctl", ["--user", "is-active", SYSTEMD_UNIT]);
  return { file, installed, running: active.exitCode === 0 };
}

/** Restarts the running login service; Windows has no service manager to ask. */
export async function restartService(env: ServiceEnv): Promise<Result<void, string>> {
  if (env.platform === "darwin") {
    if (env.uid === null) return err("launchctl needs the user id.");
    return runOk(env, "launchctl", ["kickstart", "-k", `gui/${env.uid}/${LAUNCHD_LABEL}`]);
  }
  if (env.platform === "win32") return err("Windows has no service manager Studio can ask.");
  return runOk(env, "systemctl", ["--user", "restart", SYSTEMD_UNIT]);
}

/** Stops the login service until the next login, or until it is started again. */
export async function stopService(env: ServiceEnv): Promise<Result<void, string>> {
  if (env.platform === "darwin") {
    if (env.uid === null) return err("launchctl needs the user id.");
    return runOk(env, "launchctl", ["bootout", `gui/${env.uid}/${LAUNCHD_LABEL}`]);
  }
  if (env.platform === "win32") return err("Windows has no service manager Studio can ask.");
  return runOk(env, "systemctl", ["--user", "stop", SYSTEMD_UNIT]);
}

/** How a person starts the stopped login service again. */
export function serviceStartCommand(env: ServiceEnv): string {
  if (env.platform === "darwin") return `launchctl kickstart gui/$(id -u)/${LAUNCHD_LABEL}`;
  if (env.platform === "win32") return "portless-studio";
  return "systemctl --user start portless-studio";
}

async function runOk(
  env: ServiceEnv,
  command: string,
  args: string[],
): Promise<Result<void, string>> {
  const result = await env.run(command, args);
  if (result.exitCode === 0) return ok(undefined);
  return err(`\`${command} ${args.join(" ")}\` failed: ${result.output || "no output"}`);
}

function systemdUnit(env: ServiceEnv): string {
  const quote = (value: string) =>
    `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
  const environment = Object.entries(env.variables).map(
    ([name, value]) => `Environment=${quote(`${name}=${value}`)}`,
  );
  return [
    "[Unit]",
    "Description=portless studio, a local dashboard for portless routes",
    "After=network.target",
    "",
    "[Service]",
    `ExecStart=${quote(env.nodePath)} ${quote(env.entryPath)} --no-open`,
    ...environment,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function launchAgent(env: ServiceEnv): string {
  const xml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const variables = Object.entries(env.variables).flatMap(([name, value]) => [
    `    <key>${xml(name)}</key>`,
    `    <string>${xml(value)}</string>`,
  ]);
  const log = path.join(env.homeDir, "Library", "Logs", "portless-studio.log");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${xml(env.nodePath)}</string>`,
    `    <string>${xml(env.entryPath)}</string>`,
    "    <string>--no-open</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...variables,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${xml(log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xml(log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function startupScript(env: ServiceEnv): string {
  // In a .cmd file `%` starts a variable, so a literal one is written twice.
  const quote = (value: string) => `"${value.replaceAll("%", "%%")}"`;
  return [
    "@echo off",
    "rem Starts portless studio at login. Remove it with: portless-studio service uninstall",
    `start "portless-studio" /min ${quote(env.nodePath)} ${quote(env.entryPath)} --no-open`,
    "",
  ].join("\r\n");
}
