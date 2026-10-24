import type { ListeningPort } from "../../application/port-scanner.ts";
import type { SystemIo } from "./system-io.ts";

type LsofRow = { port: number; pid: number; processName: string };

/** Reads `lsof -F pcn` output: `p<pid>`, `c<command>`, then `f<fd>` and `n<address>` per socket. */
export function parseLsofListen(text: string): LsofRow[] {
  const rows: LsofRow[] = [];
  let pid: number | null = null;
  let processName = "";
  for (const line of text.split("\n")) {
    const field = line[0];
    const value = line.slice(1).trim();
    if (field === "p") {
      pid = Number.parseInt(value, 10);
      processName = "";
    } else if (field === "c") {
      processName = value;
    } else if (field === "n" && pid !== null && Number.isInteger(pid)) {
      // `*:5432`, `127.0.0.1:5173`, `[::1]:5173`: the port is after the last colon.
      const port = Number.parseInt(value.slice(value.lastIndexOf(":") + 1), 10);
      if (port >= 1 && port <= 65535) rows.push({ port, pid, processName });
    }
  }
  return rows;
}

/** Reads `lsof -a -d cwd -F pn` output into pid -> folder. */
export function parseLsofCwds(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10);
    else if (line.startsWith("n") && pid !== null && Number.isInteger(pid)) {
      cwds.set(pid, line.slice(1).trim());
    }
  }
  return cwds;
}

/**
 * Reads `ps -ww -o pid=,comm=` into pid -> executable. macOS prints the full path, which may hold
 * spaces; a bare name (a process started through PATH) says nothing about where it lives.
 */
export function parsePsExecutables(text: string): Map<number, string> {
  const executables = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\/.*?)\s*$/.exec(line);
    if (match?.[2]) executables.set(Number(match[1]), match[2]);
  }
  return executables;
}

/** Lists listening ports with `lsof` and `ps`, which ship with macOS. */
export async function listMacosPorts(io: SystemIo): Promise<ListeningPort[]> {
  const listen = await io.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
  const rows = parseLsofListen(listen.stdout);
  if (rows.length === 0) return [];

  const pids = [...new Set(rows.map((row) => row.pid))];
  const [cwd, ps] = await Promise.all([
    io.run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"]),
    // -ww: without it ps cuts long paths at the terminal width.
    io.run("ps", ["-ww", "-o", "pid=,comm=", "-p", pids.join(",")]),
  ]);
  const cwds = parseLsofCwds(cwd.stdout);
  const executables = parsePsExecutables(ps.stdout);

  const byPort = new Map<number, ListeningPort>();
  for (const row of rows) {
    if (byPort.has(row.port)) continue;
    byPort.set(row.port, {
      ...row,
      cwd: cwds.get(row.pid) ?? null,
      executable: executables.get(row.pid) ?? null,
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}
