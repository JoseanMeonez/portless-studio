import type { ListeningPort } from "../../application/port-scanner.ts";
import type { SystemIo } from "./system-io.ts";

/** `st` column value for a socket in LISTEN state. */
const LISTEN = "0A";
const SOCKET_LINK = /^socket:\[(\d+)\]$/;
const DELETED_SUFFIX = " (deleted)";

export type ProcSocket = { port: number; inode: string };

/** Reads the LISTEN rows of `/proc/net/tcp` or `/proc/net/tcp6`. */
export function parseProcNetTcp(text: string): ProcSocket[] {
  const sockets: ProcSocket[] = [];
  for (const line of text.split("\n")) {
    const columns = line.trim().split(/\s+/);
    // sl, local_address, rem_address, st, tx:rx, tr:when, retrnsmt, uid, timeout, inode
    if (columns.length < 10 || columns[3] !== LISTEN) continue;
    const portHex = columns[1]?.split(":")[1] ?? "";
    const port = Number.parseInt(portHex, 16);
    const inode = columns[9] ?? "";
    if (!/^[0-9A-F]{4}$/i.test(portHex) || port < 1 || !/^\d+$/.test(inode)) continue;
    sockets.push({ port, inode });
  }
  return sockets;
}

/**
 * Lists listening ports from `/proc`. A socket is linked to its process through the
 * `/proc/<pid>/fd/*` links; processes of other users cannot be read and stay unknown.
 */
export async function listLinuxPorts(io: SystemIo): Promise<ListeningPort[]> {
  const sockets = [
    ...parseProcNetTcp(io.readFile("/proc/net/tcp") ?? ""),
    ...parseProcNetTcp(io.readFile("/proc/net/tcp6") ?? ""),
  ];
  const pids = pidsByInode(io, new Set(sockets.map((socket) => socket.inode)));

  const byPort = new Map<number, ListeningPort>();
  for (const socket of sockets) {
    const known = byPort.get(socket.port);
    if (known?.pid != null) continue;
    const pid = pids.get(socket.inode) ?? null;
    byPort.set(socket.port, {
      port: socket.port,
      pid,
      processName: pid === null ? "" : readProcessName(io, pid),
      cwd: pid === null ? null : readCwd(io, pid),
      executable:
        pid === null
          ? null
          : (io.readLink(`/proc/${pid}/exe`)?.replace(DELETED_SUFFIX, "") ?? null),
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/** Walks every readable process once and stops as soon as all wanted inodes are found. */
export function pidsByInode(io: SystemIo, wanted: Set<string>): Map<string, number> {
  const found = new Map<string, number>();
  if (wanted.size === 0) return found;
  for (const entry of io.readDir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    for (const fd of io.readDir(`/proc/${entry}/fd`)) {
      const inode = SOCKET_LINK.exec(io.readLink(`/proc/${entry}/fd/${fd}`) ?? "")?.[1];
      if (inode && wanted.has(inode) && !found.has(inode)) found.set(inode, Number(entry));
    }
    if (found.size === wanted.size) break;
  }
  return found;
}

/**
 * The executable's file name, so ignoredProcesses matches `code` or `node`. `comm` is only the
 * fallback: Node renames its main thread to `MainThread` and tools like `ng` rewrite it.
 */
function readProcessName(io: SystemIo, pid: number): string {
  const exe = io.readLink(`/proc/${pid}/exe`)?.replace(DELETED_SUFFIX, "");
  const name = exe?.split("/").pop();
  if (name) return name;
  return io.readFile(`/proc/${pid}/comm`)?.trim() ?? "";
}

function readCwd(io: SystemIo, pid: number): string | null {
  const cwd = io.readLink(`/proc/${pid}/cwd`);
  if (!cwd || cwd.endsWith(DELETED_SUFFIX)) return null;
  return cwd;
}
