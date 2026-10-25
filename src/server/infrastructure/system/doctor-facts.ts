import { createServer } from "node:net";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "../../../core/config/studio-config.ts";
import type { ConfigStore } from "../../application/config-store.ts";
import type { ContainerReading } from "../../application/container-source.ts";
import type {
  BrowserTrust,
  DockerFacts,
  DoctorFacts,
  LowPortFacts,
  PortHolder,
  ProxyProcess,
  RoutesFileFacts,
} from "../../application/doctor.ts";
import type { ListeningPort, ProbePort } from "../../application/port-scanner.ts";
import type { ProcessControl, ProcessOwner } from "../../application/process-control.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import type { LoginServiceState } from "../../application/studio-service.ts";
import type { SystemIo } from "./system-io.ts";
import { ownerFromUid, parseProcStatusUid } from "./system-process-control.ts";

export type DoctorFactsOptions = {
  platform: NodeJS.Platform;
  homeDir: string;
  stateDir: string;
  /** The uid Studio runs as; null on Windows. */
  uid: number | null;
  registry: RouteRegistry;
  configStore: ConfigStore;
  processes: ProcessControl;
  io: SystemIo;
  listPorts: () => Promise<ListeningPort[]>;
  probe: ProbePort;
  /** Asks the login service manager; omitted when it cannot be known. */
  loginService?: () => Promise<LoginServiceState | null>;
  /** Whether OS notifications can be shown here; omitted when not checked. */
  systemNotifier?: () => Promise<"available" | "limited" | "missing" | "unsupported">;
  /**
   * Whether a loopback port can be bound right now. Asked when the port list does not show who
   * holds Studio's port, as on macOS where lsof cannot see root's listeners. Defaults to a real
   * bind on macOS and to not asking elsewhere.
   */
  canBind?: (port: number) => Promise<boolean>;
  /** Whether portless's routes.json reads; omitted when not checked. */
  routesFile?: () => RoutesFileFacts;
  /** Lists Docker containers; omitted when not checked. */
  docker?: () => Promise<ContainerReading>;
  /** Whether this user may listen on a low port; `testBind` in production, omitted to skip. */
  lowPort?: (port: number) => Promise<LowPortFacts>;
};

/** A process from /proc (exact `args`) or from ps (`args` split on spaces, plus the raw `line`). */
type ProcessRow = { pid: number; uid: number | null; args: string[]; line?: string };

// The program, or a runtime running the script, is portless; a directory part never holds " -",
// so `zsh -c /usr/bin/portless proxy start` is not a proxy.
const PROXY_LINE =
  /^(?:(?:(?! -).)*[\\/])?(?:(?:node|bun|deno)(?:\.exe)?\s+(?:(?:(?! -).)*[\\/])?)?portless(?:\.[cm]?js|\.cmd)?\s+proxy\s+start(?:\s+(.*))?$/i;

/**
 * `portless proxy start ...` as node runs it, e.g. `node /path/bin/portless proxy start --port
 * 1355 --no-tls`. Null for anything else.
 */
export function parsePortlessProxyArgs(
  args: string[],
): { port: number | null; https: boolean } | null {
  const index = args.findIndex((arg) => /^portless(\.js|\.cmd)?$/i.test(path.basename(arg)));
  // The binary must be the program, or the script a JavaScript runtime runs.
  const runtime = index === 1 && /^(node|bun|deno)(\.exe)?$/i.test(path.basename(args[0] ?? ""));
  if ((index !== 0 && !runtime) || args[index + 1] !== "proxy" || args[index + 2] !== "start") {
    return null;
  }
  return proxyOptions(args.slice(index + 3));
}

/**
 * The same as `parsePortlessProxyArgs` for a whole `ps` line, whose arguments cannot be split
 * where paths hold spaces.
 */
export function parsePortlessProxyLine(
  line: string,
): { port: number | null; https: boolean } | null {
  const match = PROXY_LINE.exec(line.trim());
  if (!match) return null;
  return proxyOptions((match[1] ?? "").split(/\s+/).filter(Boolean));
}

function proxyOptions(rest: string[]): { port: number | null; https: boolean } {
  let port: number | null = null;
  for (const [i, arg] of rest.entries()) {
    const value = arg === "--port" || arg === "-p" ? rest[i + 1] : /^--port=(\d+)$/.exec(arg)?.[1];
    const parsed = Number.parseInt(value ?? "", 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
  }
  return { port, https: rest.includes("--https") };
}

/**
 * Reads `ps -ww -A -o pid=,uid=,args=`. `args` is split on spaces, so paths with spaces split
 * too; `line` keeps the command line whole for `parsePortlessProxyLine`.
 */
export function parsePsProcesses(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match?.[3]) continue;
    const command = match[3].trim();
    rows.push({
      pid: Number(match[1]),
      uid: Number(match[2]),
      args: command.split(/\s+/),
      line: command,
    });
  }
  return rows;
}

function proxyOf(row: ProcessRow): { port: number | null; https: boolean } | null {
  return row.line === undefined
    ? parsePortlessProxyArgs(row.args)
    : parsePortlessProxyLine(row.line);
}

/** True when `certutil -L` lists a certificate whose nickname mentions portless. */
export function parseCertutilList(text: string): boolean {
  return text.split("\n").some((line) => /portless/i.test(line));
}

/** Every `portless proxy start` process; null where the process list cannot be read (Windows). */
export async function listProxyProcesses(
  platform: NodeJS.Platform,
  io: SystemIo,
  uid: number | null,
): Promise<ProxyProcess[] | null> {
  if (platform === "win32") return null;
  const rows = platform === "darwin" ? await psRows(io) : procRows(io);
  return rows.flatMap((row) => {
    const proxy = proxyOf(row);
    if (!proxy) return [];
    const owner: ProcessOwner = ownerFromUid(row.uid, uid);
    return [{ pid: row.pid, ...proxy, owner }];
  });
}

/**
 * The pids among `pids` that run `portless proxy start`, so port detection never offers the proxy
 * as a dev server, whatever port it listens on. Reads only those processes. Windows has no cheap
 * way to read a command line, so it finds none there and relies on the `proxy.port` state file.
 */
export async function proxyPidsAmong(
  platform: NodeJS.Platform,
  io: SystemIo,
  pids: readonly number[],
): Promise<Set<number>> {
  if (platform === "win32" || pids.length === 0) return new Set();
  const rows: ProcessRow[] =
    platform === "darwin"
      ? parsePsProcesses(
          (await io.run("ps", ["-ww", "-o", "pid=,uid=,args=", "-p", pids.join(",")])).stdout,
        )
      : pids.flatMap((pid) => {
          const cmdline = io.readFile(`/proc/${pid}/cmdline`);
          return cmdline ? [{ pid, uid: null, args: cmdline.split("\0").filter(Boolean) }] : [];
        });
  return new Set(rows.filter((row) => proxyOf(row)).map((row) => row.pid));
}

/** Gathers the facts the doctor checks. Each part is read once; nothing is changed. */
export async function collectDoctorFacts(options: DoctorFactsOptions): Promise<DoctorFacts> {
  const { platform, registry, configStore } = options;
  const [state, proxyPid, stored, proxyProcesses, loginService, systemNotifier, docker, port80] =
    await Promise.all([
      registry.readSnapshot(),
      registry.proxyPid(),
      configStore.read(),
      listProxyProcesses(platform, options.io, options.uid),
      options.loginService ? options.loginService() : Promise.resolve(null),
      options.systemNotifier ? options.systemNotifier() : Promise.resolve(undefined),
      options.docker ? dockerFacts(options.docker) : Promise.resolve(undefined),
      options.lowPort ? options.lowPort(80) : Promise.resolve(undefined),
    ]);
  const config = stored.ok ? stored.value : DEFAULT_CONFIG;
  const proxyOwner =
    state.proxy.running && proxyPid !== null
      ? await options.processes.ownerOf(proxyPid)
      : "unknown";
  const https = state.proxy.running ? state.proxy.https : config.proxyHttps;

  return {
    platform,
    portless: state.portless,
    proxy: state.proxy,
    proxyPid,
    proxyOwner,
    proxyProcesses,
    config,
    configError: stored.ok ? null : stored.error.message,
    configPath: configStore.path,
    caFile: pathsOf(platform).join(options.stateDir, "ca.pem"),
    browserTrust: https ? await browserTrust(options) : "unknown",
    studioPort: { port: config.port, holder: await portHolder(config.port, options) },
    loginService,
    ...(systemNotifier === undefined ? {} : { systemNotifier }),
    ...(options.routesFile ? { routesFile: options.routesFile() } : {}),
    ...(docker === undefined ? {} : { docker }),
    ...(port80 === undefined ? {} : { port80 }),
  };
}

/** Only how many containers run reaches the doctor, never their names. */
async function dockerFacts(read: () => Promise<ContainerReading>): Promise<DockerFacts> {
  const reading = await read().catch((): ContainerReading => ({ state: "unavailable" }));
  return reading.state === "ok"
    ? { state: "ok", containers: reading.containers.length }
    : { state: reading.state };
}

/**
 * Tries to listen on a loopback port and closes it at once, without sudo: `denied` when the system
 * refuses this user (Linux below `ip_unprivileged_port_start`), `in-use` when a program holds it.
 */
export function testBind(port: number): Promise<LowPortFacts> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      resolve(error.code === "EADDRINUSE" ? "in-use" : "denied"),
    );
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(() => resolve("free")),
    );
  });
}

/** Paths are built for the platform the facts describe, not the one running the code. */
function pathsOf(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Reads, never changes, the certificate store the browsers of this system use. */
async function browserTrust(options: DoctorFactsOptions): Promise<BrowserTrust> {
  if (options.platform === "linux") return chromeTrust(options);
  if (options.platform === "darwin") {
    const found = await options.io.run("security", ["find-certificate", "-c", "portless"]);
    if (found.exitCode === null) return "unknown";
    return found.exitCode === 0 ? "trusted" : "not-trusted";
  }
  if (options.platform === "win32") {
    // The user's Root store first; one an Administrator trusted for the machine counts too.
    for (const scope of [["-user"], []]) {
      const listed = await options.io.run("certutil", [...scope, "-verifystore", "Root"]);
      if (listed.exitCode === null) return "unknown";
      if (/portless/i.test(listed.stdout)) return "trusted";
    }
    return "not-trusted";
  }
  return "unknown";
}

async function chromeTrust({ io, homeDir, platform }: DoctorFactsOptions): Promise<BrowserTrust> {
  const store = pathsOf(platform).join(homeDir, ".pki", "nssdb");
  if (io.readDir(store).length === 0) return "no-store";
  const listed = await io.run("certutil", ["-L", "-d", `sql:${store}`]);
  if (listed.exitCode === null) return "no-certutil";
  if (listed.exitCode !== 0) return "unknown";
  return parseCertutilList(listed.stdout) ? "trusted" : "not-trusted";
}

async function portHolder(port: number, options: DoctorFactsOptions): Promise<PortHolder> {
  const listening = (await options.listPorts().catch(() => [])).find((item) => item.port === port);
  if (!listening) {
    const canBind = options.canBind ?? (options.platform === "darwin" ? bindsOnLoopback : null);
    if (canBind === null || (await canBind(port))) return { kind: "free" };
    return { kind: "other", pid: null, processName: "" };
  }
  const answer = await options.probe(port);
  if (answer?.studio) return { kind: "studio" };
  return { kind: "other", pid: listening.pid, processName: listening.processName };
}

function procRows(io: SystemIo): ProcessRow[] {
  return io
    .readDir("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .flatMap((entry) => {
      const cmdline = io.readFile(`/proc/${entry}/cmdline`);
      if (!cmdline) return [];
      const status = io.readFile(`/proc/${entry}/status`);
      return [
        {
          pid: Number(entry),
          uid: status === null ? null : parseProcStatusUid(status),
          args: cmdline.split("\0").filter(Boolean),
        },
      ];
    });
}

async function psRows(io: SystemIo): Promise<ProcessRow[]> {
  // -ww: without it ps cuts the command line at the terminal width.
  const listed = await io.run("ps", ["-ww", "-A", "-o", "pid=,uid=,args="]);
  return parsePsProcesses(listed.stdout);
}

/** Binds the port on loopback and lets it go at once. */
function bindsOnLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}
