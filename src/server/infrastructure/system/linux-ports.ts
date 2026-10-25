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

/** Clock ticks per second, the unit of `/proc/<pid>/stat` times; 100 on every common kernel. */
export const DEFAULT_CLOCK_TICKS = 100;

/**
 * When a process started, in epoch milliseconds, from field 22 of `/proc/<pid>/stat` (clock ticks
 * since boot) and `btime` in `/proc/stat` (boot time in epoch seconds). Null when unreadable.
 */
export function processStartTime(
  stat: string | null,
  procStat: string | null,
  ticksPerSecond: number,
): number | null {
  if (stat === null || procStat === null || ticksPerSecond <= 0) return null;
  // The command name in field 2 may hold spaces and parentheses, so count fields after the last ")".
  const fields = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const ticks = Number(fields[19]);
  const boot = Number(/^btime\s+(\d+)$/m.exec(procStat)?.[1]);
  if (!Number.isFinite(ticks) || !Number.isFinite(boot) || boot <= 0) return null;
  return Math.round(boot * 1000 + (ticks * 1000) / ticksPerSecond);
}

/** `getconf CLK_TCK`, or the usual 100 when it cannot run. */
export async function readClockTicks(io: SystemIo): Promise<number> {
  const answer = await io.run("getconf", ["CLK_TCK"]).catch(() => null);
  const ticks = Number(answer?.stdout.trim());
  return Number.isInteger(ticks) && ticks > 0 ? ticks : DEFAULT_CLOCK_TICKS;
}

/**
 * Lists listening ports from `/proc`. A socket is linked to its process through the
 * `/proc/<pid>/fd/*` links; processes of other users cannot be read and stay unknown.
 */
export async function listLinuxPorts(
  io: SystemIo,
  ticksPerSecond: () => Promise<number> = async () => DEFAULT_CLOCK_TICKS,
): Promise<ListeningPort[]> {
  const sockets = [
    ...parseProcNetTcp(io.readFile("/proc/net/tcp") ?? ""),
    ...parseProcNetTcp(io.readFile("/proc/net/tcp6") ?? ""),
  ];
  const pids = pidsByInode(io, new Set(sockets.map((socket) => socket.inode)));
  const ticks = pids.size > 0 ? await ticksPerSecond() : DEFAULT_CLOCK_TICKS;
  const procStat = pids.size > 0 ? io.readFile("/proc/stat") : null;

  const byPort = new Map<number, ListeningPort>();
  for (const socket of sockets) {
    const known = byPort.get(socket.port);
    if (known?.pid != null) continue;
    const pid = pids.get(socket.inode) ?? null;
    const startedAt =
      pid === null ? null : processStartTime(io.readFile(`/proc/${pid}/stat`), procStat, ticks);
    byPort.set(socket.port, {
      port: socket.port,
      pid,
      processName: pid === null ? "" : readProcessName(io, pid),
      cwd: pid === null ? null : readCwd(io, pid),
      executable:
        pid === null
          ? null
          : (io.readLink(`/proc/${pid}/exe`)?.replace(DELETED_SUFFIX, "") ?? null),
      ...(startedAt === null ? {} : { startedAt }),
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
