import type { ListeningPort } from "../../application/port-scanner.ts";
import type { SystemIo } from "./system-io.ts";

// `TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  8120`. A listening socket has no remote port, so a
// foreign address ending in `:0` identifies it even when Windows translates the state column.
const ROW = /^\s*TCP\s+(\S+):(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/i;

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
 * Lists listening ports with `netstat` and `tasklist`, which ship with Windows. Windows has no
 * command that prints another process's working folder, so `cwd` is always null and detected
 * ports get no suggested name there.
 */
export async function listWindowsPorts(io: SystemIo): Promise<ListeningPort[]> {
  const [v4, v6, tasks] = await Promise.all([
    io.run("netstat", ["-ano", "-p", "TCP"]),
    io.run("netstat", ["-ano", "-p", "TCPv6"]),
    io.run("tasklist", ["/fo", "csv", "/nh"]),
  ]);
  const names = parseTasklist(tasks.stdout);

  const byPort = new Map<number, ListeningPort>();
  for (const row of [...parseNetstat(v4.stdout), ...parseNetstat(v6.stdout)]) {
    if (byPort.has(row.port)) continue;
    byPort.set(row.port, {
      port: row.port,
      pid: row.pid,
      processName: names.get(row.pid) ?? "",
      cwd: null,
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}
