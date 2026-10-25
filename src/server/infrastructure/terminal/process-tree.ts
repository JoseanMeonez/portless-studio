import * as fs from "node:fs";
import type { ProcessTree } from "../../application/terminals.ts";
import { runProcess } from "../system/process-runner.ts";

/** Deeper than any real chain of shells and tools; a guard against a bad read. */
const MAX_DEPTH = 64;
/** One `ps` answer serves every pid of a scan on macOS. */
const PS_CACHE_MS = 2_000;

/** The parent pid in the text of `/proc/<pid>/stat`; the name in parentheses may hold anything. */
export function parseStatParent(stat: string): number | null {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const parent = Number(fields[1]);
  return stat.includes(")") && Number.isInteger(parent) ? parent : null;
}

/** Every pid's parent from `ps -A -o pid=,ppid=`. */
export function parsePsParents(output: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) parents.set(Number(match[1]), Number(match[2]));
  }
  return parents;
}

/** The parent, its parent and so on, ending before pid 0 or at a pid already seen. */
export function walkAncestors(pid: number, parentOf: (pid: number) => number | null): number[] {
  const ancestors: number[] = [];
  const seen = new Set([pid]);
  let current = parentOf(pid);
  while (current !== null && current > 0 && !seen.has(current) && ancestors.length < MAX_DEPTH) {
    ancestors.push(current);
    seen.add(current);
    current = parentOf(current);
  }
  return ancestors;
}

/**
 * Parent processes on this machine: `/proc` on Linux, one `ps` on macOS. Windows answers nothing,
 * so terminals there list no ports.
 */
export function systemProcessTree(platform: NodeJS.Platform = process.platform): ProcessTree {
  if (platform === "linux") {
    return {
      ancestors: async (pid) =>
        walkAncestors(pid, (current) => {
          try {
            return parseStatParent(fs.readFileSync(`/proc/${current}/stat`, "utf8"));
          } catch {
            return null;
          }
        }),
    };
  }
  if (platform === "darwin") {
    let cached: { at: number; parents: Promise<Map<number, number>> } | null = null;
    const table = () => {
      if (!cached || Date.now() - cached.at > PS_CACHE_MS) {
        cached = {
          at: Date.now(),
          parents: runProcess("ps", ["-A", "-o", "pid=,ppid="], { timeoutMs: 3_000 }).then(
            (outcome) => parsePsParents(outcome.exitCode === 0 ? outcome.stdout : ""),
          ),
        };
      }
      return cached.parents;
    };
    return {
      ancestors: async (pid) => {
        const parents = await table();
        return walkAncestors(pid, (current) => parents.get(current) ?? null);
      },
    };
  }
  return { ancestors: async () => [] };
}
