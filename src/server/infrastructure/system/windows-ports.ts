import * as path from "node:path";
import type { ListeningPort } from "../../application/port-scanner.ts";
import { powershellArgs } from "./powershell.ts";
import type { SystemIo } from "./system-io.ts";

// `TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  8120`. A listening socket has no remote port, so a
// foreign address ending in `:0` identifies it even when Windows translates the state column.
const ROW = /^\s*TCP\s+(\S+):(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/i;
/** The idle process and the kernel: their ports belong to Windows, never to a dev server. */
const SYSTEM_PIDS = new Map([
  [0, "System Idle Process"],
  [4, "System"],
]);
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const SCRIPT = /\.(?:[cm]?js|ts|py)$/i;

export type Win32Process = {
  name: string;
  executable: string | null;
  commandLine: string | null;
  /** `CreationDate` in epoch milliseconds; absent when Windows did not give it. */
  startedAt?: number;
};

/** What a scan learned about each pid, and when; kept between scans by `listPortsFor`. */
export type Win32ProcessCache = Map<number, { info: Win32Process; at: number }>;

/** Windows reuses pids, so what a pid runs is asked again after this long. */
const PROCESS_INFO_TTL_MS = 30_000;

/** Reads the listening rows of `netstat -ano -p TCP` or `-p TCPv6`. */
export function parseNetstat(text: string): { port: number; pid: number }[] {
  const rows: { port: number; pid: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = ROW.exec(line);
    if (!match) continue;
    const port = Number(match[2]);
    if (port >= 1 && port <= 65535) rows.push({ port, pid: Number(match[3]) });
  }
  return rows;
}

/** Reads `tasklist /fo csv /nh` into pid -> name, without the `.exe` suffix. */
export function parseTasklist(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)"/.exec(line);
    if (!match?.[1]) continue;
    names.set(Number(match[2]), match[1].replace(/\.exe$/i, ""));
  }
  return names;
}

/**
 * Reads `Get-CimInstance Win32_Process | Select-Object ProcessId, Name, ExecutablePath,
 * CommandLine | ConvertTo-Json`, which prints one object instead of a list for one process.
 */
export function parseWin32Processes(text: string): Map<number, Win32Process> {
  const processes = new Map<number, Win32Process>();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return processes;
  }
  for (const item of Array.isArray(json) ? json : [json]) {
    if (typeof item !== "object" || item === null) continue;
    const pid: unknown = Reflect.get(item, "ProcessId");
    const name: unknown = Reflect.get(item, "Name");
    if (typeof pid !== "number" || typeof name !== "string") continue;
    const executable: unknown = Reflect.get(item, "ExecutablePath");
    const commandLine: unknown = Reflect.get(item, "CommandLine");
    const startedAt: unknown = Reflect.get(item, "StartedAt");
    processes.set(pid, {
      name: name.replace(/\.exe$/i, ""),
      executable: typeof executable === "string" && executable !== "" ? executable : null,
      commandLine: typeof commandLine === "string" && commandLine !== "" ? commandLine : null,
      ...(typeof startedAt === "number" && startedAt > 0 ? { startedAt } : {}),
    });
  }
  return processes;
}

/** Splits a command line the way Windows programs read it (CommandLineToArgvW rules). */
export function splitWindowsCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") {
      let count = 0;
      while (line[i + count] === "\\") count++;
      if (line[i + count] === '"') {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2 === 1) current += '"';
        else quoted = !quoted;
        i += count;
      } else {
        current += "\\".repeat(count);
        i += count - 1;
      }
      started = true;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if ((char === " " || char === "\t") && !quoted) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/**
 * The project folder of a process, read from the script its runtime runs, because Windows has
 * no command that prints another process's working folder. `node C:\app\node_modules\vite\...`
 * gives `C:\app`; `node C:\api\server.mjs` gives `C:\api`; a relative script gives nothing.
 */
export function folderFromCommandLine(commandLine: string | null): string | null {
  if (!commandLine) return null;
  for (const arg of splitWindowsCommandLine(commandLine).slice(1)) {
    if (!ABSOLUTE.test(arg)) continue;
    const normalized = path.win32.normalize(arg);
    const modules = normalized.toLowerCase().indexOf("\\node_modules\\");
    if (modules > 0) return normalized.slice(0, modules);
    if (SCRIPT.test(normalized)) return path.win32.dirname(normalized);
  }
  return null;
}

/**
 * Lists listening ports with `netstat` and one PowerShell `Win32_Process` query for the names,
 * executables and command lines of the listening processes it has not seen in the last 30
 * seconds, so most scans start no PowerShell at all. Without PowerShell, `tasklist` still gives
 * the names.
 */
export async function listWindowsPorts(
  io: SystemIo,
  cache: Win32ProcessCache = new Map(),
  now: () => number = Date.now,
): Promise<ListeningPort[]> {
  const [v4, v6] = await Promise.all([
    io.run("netstat", ["-ano", "-p", "TCP"]),
    io.run("netstat", ["-ano", "-p", "TCPv6"]),
  ]);
  const rows = [...parseNetstat(v4.stdout), ...parseNetstat(v6.stdout)];
  const pids = [...new Set(rows.map((row) => row.pid))]
    .filter((pid) => !SYSTEM_PIDS.has(pid))
    .sort((a, b) => a - b);
  const processes = await cachedProcesses(io, pids, cache, now());

  const byPort = new Map<number, ListeningPort>();
  for (const row of rows) {
    if (byPort.has(row.port)) continue;
    const system = SYSTEM_PIDS.get(row.pid);
    const info = processes.get(row.pid);
    byPort.set(row.port, {
      port: row.port,
      pid: system === undefined ? row.pid : null,
      processName: system ?? info?.name ?? "",
      cwd: folderFromCommandLine(info?.commandLine ?? null),
      executable: info?.executable ?? null,
      ...(system === undefined && info?.startedAt !== undefined
        ? { startedAt: info.startedAt }
        : {}),
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

async function cachedProcesses(
  io: SystemIo,
  pids: number[],
  cache: Win32ProcessCache,
  at: number,
): Promise<Map<number, Win32Process>> {
  for (const [pid, entry] of cache) {
    if (!pids.includes(pid) || at - entry.at >= PROCESS_INFO_TTL_MS) cache.delete(pid);
  }
  const unknown = pids.filter((pid) => !cache.has(pid));
  const { processes: fresh, complete } = await readProcesses(io, unknown);
  // Names from tasklist lack paths, so after a PowerShell failure every pid is asked again.
  if (complete) for (const [pid, info] of fresh) cache.set(pid, { info, at });
  return new Map([...[...cache].map(([pid, entry]) => [pid, entry.info] as const), ...fresh]);
}

async function readProcesses(
  io: SystemIo,
  pids: number[],
): Promise<{ processes: Map<number, Win32Process>; complete: boolean }> {
  if (pids.length === 0) return { processes: new Map(), complete: true };
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const script =
    `Get-CimInstance Win32_Process -Filter '${filter}' | ` +
    "Select-Object ProcessId, Name, ExecutablePath, CommandLine, " +
    // A plain number, because ConvertTo-Json writes dates differently in each PowerShell version.
    "@{n='StartedAt';e={if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() }}} | " +
    "ConvertTo-Json -Compress";
  const queried = await io.run("powershell", powershellArgs(script));
  const processes = queried.exitCode === 0 ? parseWin32Processes(queried.stdout) : new Map();
  if (processes.size > 0) return { processes, complete: true };

  const tasks = await io.run("tasklist", ["/fo", "csv", "/nh"]);
  const names = parseTasklist(tasks.stdout);
  const fallback = new Map(
    [...names].map(([pid, name]) => [pid, { name, executable: null, commandLine: null }]),
  );
  return { processes: fallback, complete: false };
}
