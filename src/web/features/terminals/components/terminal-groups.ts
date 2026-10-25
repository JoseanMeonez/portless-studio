import { directUrl } from "../../../../core/ports/direct-url.ts";
import type { TerminalInfo, TerminalPort } from "../../../../core/terminals/terminal.ts";

export type TerminalGroup = {
  name: string;
  branch: string | null;
  path: string;
  terminals: TerminalInfo[];
};

/** `restart`: stopped by a Studio restart and waiting to run again. */
export type TerminalState = "running" | "ok" | "failed" | "restart";

export function stateOf(terminal: TerminalInfo): TerminalState {
  if (terminal.status === "running") return "running";
  if (terminal.stoppedByRestart) return "restart";
  return terminal.exitCode === 0 ? "ok" : "failed";
}

/** What the toolbar says about the command. */
export function statusText(terminal: TerminalInfo): string {
  if (terminal.status === "running") return "Running";
  if (terminal.stoppedByRestart) return "Stopped by a Studio restart";
  return terminal.exitCode === null ? "Stopped" : `Exited with code ${terminal.exitCode}`;
}

/** A short status for list items: `running`, `exited 1`, `stopped`. */
export function shortStatus(terminal: TerminalInfo): string {
  if (terminal.status === "running") return "running";
  if (terminal.stoppedByRestart) return "stopped by restart";
  return terminal.exitCode === null ? "stopped" : `exited ${terminal.exitCode}`;
}

/** The project and worktree a terminal runs in (`acme-monorepo / falcon`), else its folder name. */
export function folderLabel(terminal: TerminalInfo): string {
  return terminal.project
    ? `${terminal.project}${terminal.worktree ? ` / ${terminal.worktree}` : ""}`
    : lastSegment(terminal.cwd);
}

/** Where a port opens: its route through the proxy, else its direct URL. */
export function portUrl(item: TerminalPort): string {
  return item.url ?? directUrl(item.port);
}

/** A port as a short chip label: the route name, else `:3000`. */
export function portLabel(item: TerminalPort): string {
  return item.route ?? `:${item.port}`;
}

/** Who started a terminal, for its details. */
export function starterText(terminal: TerminalInfo): string | null {
  if (terminal.startedBy === "program") return "the CLI or an agent (run or MCP)";
  if (terminal.startedBy === "person") return "a person on the page";
  return null;
}

/** A local date and time, short: `Oct 24, 14:05`. */
export function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Terminals grouped by project and worktree (`acme-monorepo / falcon`), in the order each first
 * appears; a folder Studio does not know is its own group, named after the folder.
 */
export function groupByWorktree(terminals: readonly TerminalInfo[]): TerminalGroup[] {
  const groups = new Map<string, TerminalGroup>();
  for (const terminal of terminals) {
    const name = folderLabel(terminal);
    const group = groups.get(name) ?? {
      name,
      branch: terminal.branch ?? null,
      path: terminal.cwd,
      terminals: [],
    };
    group.terminals.push(terminal);
    groups.set(name, group);
  }
  return [...groups.values()];
}

/** Whether every word of `query` is in the terminal's title, command, folder or project. */
export function matchesFilter(terminal: TerminalInfo, query: string): boolean {
  const haystack = [terminal.title, terminal.command, terminal.cwd, terminal.project ?? ""]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function lastSegment(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}
