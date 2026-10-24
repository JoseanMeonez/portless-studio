import * as path from "node:path";
import { DEFAULT_CONFIG } from "../../../core/config/studio-config.ts";
import type { ConfigStore } from "../../application/config-store.ts";
import type {
  BrowserTrust,
  DoctorFacts,
  PortHolder,
  ProxyProcess,
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
  systemNotifier?: () => Promise<"available" | "missing" | "unsupported">;
};

type ProcessRow = { pid: number; uid: number | null; args: string[] };

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
  const rest = args.slice(index + 3);
  let port: number | null = null;
  for (const [i, arg] of rest.entries()) {
    const value = arg === "--port" || arg === "-p" ? rest[i + 1] : /^--port=(\d+)$/.exec(arg)?.[1];
    const parsed = Number.parseInt(value ?? "", 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
  }
  return { port, https: rest.includes("--https") };
}

/** Reads `ps -A -o pid=,uid=,args=`. Arguments are split on spaces; paths with spaces split too. */
export function parsePsProcesses(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match?.[3]) continue;
    rows.push({ pid: Number(match[1]), uid: Number(match[2]), args: match[3].trim().split(/\s+/) });
  }
  return rows;
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
    const proxy = parsePortlessProxyArgs(row.args);
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
          (await io.run("ps", ["-o", "pid=,uid=,args=", "-p", pids.join(",")])).stdout,
        )
      : pids.flatMap((pid) => {
          const cmdline = io.readFile(`/proc/${pid}/cmdline`);
          return cmdline ? [{ pid, uid: null, args: cmdline.split("\0").filter(Boolean) }] : [];
        });
  return new Set(rows.filter((row) => parsePortlessProxyArgs(row.args)).map((row) => row.pid));
}

/** Gathers the facts the doctor checks. Each part is read once; nothing is changed. */
export async function collectDoctorFacts(options: DoctorFactsOptions): Promise<DoctorFacts> {
  const { platform, registry, configStore } = options;
  const [state, proxyPid, stored, proxyProcesses, loginService, systemNotifier] = await Promise.all(
    [
      registry.readSnapshot(),
      registry.proxyPid(),
      configStore.read(),
      listProxyProcesses(platform, options.io, options.uid),
      options.loginService ? options.loginService() : Promise.resolve(null),
      options.systemNotifier ? options.systemNotifier() : Promise.resolve(undefined),
    ],
  );
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
    caFile: path.join(options.stateDir, "ca.pem"),
    browserTrust: https && platform === "linux" ? await chromeTrust(options) : "unknown",
    studioPort: { port: config.port, holder: await portHolder(config.port, options) },
    loginService,
    ...(systemNotifier === undefined ? {} : { systemNotifier }),
  };
}

async function chromeTrust({ io, homeDir }: DoctorFactsOptions): Promise<BrowserTrust> {
  const store = path.join(homeDir, ".pki", "nssdb");
  if (io.readDir(store).length === 0) return "no-store";
  const listed = await io.run("certutil", ["-L", "-d", `sql:${store}`]);
  if (listed.exitCode === null) return "no-certutil";
  if (listed.exitCode !== 0) return "unknown";
  return parseCertutilList(listed.stdout) ? "trusted" : "not-trusted";
}

async function portHolder(port: number, options: DoctorFactsOptions): Promise<PortHolder> {
  const listening = (await options.listPorts().catch(() => [])).find((item) => item.port === port);
  if (!listening) return { kind: "free" };
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
  const listed = await io.run("ps", ["-A", "-o", "pid=,uid=,args="]);
  return parsePsProcesses(listed.stdout);
}
