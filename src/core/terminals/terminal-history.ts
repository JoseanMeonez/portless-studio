/**
 * What Studio keeps about terminals between runs, in `terminals.json` next to the config: the
 * terminals that were running when it stopped, so they can run again, and the last commands run
 * in each folder, offered when a new terminal opens there. See docs/terminals.md.
 */

/** `program`: the CLI's `run` or an agent through MCP. `person`: someone on the page. */
export type TerminalStarter = "program" | "person";

/** A terminal that was running when Studio stopped. */
export type SavedTerminal = {
  /** What ran; empty for the interactive shell. */
  command: string;
  cwd: string;
  title: string;
  /** Epoch milliseconds. */
  startedAt: number;
  startedBy: TerminalStarter;
  project: string | null;
  worktree: string | null;
  branch: string | null;
};

export type TerminalHistory = {
  running: SavedTerminal[];
  /** Folder to its last commands, newest first. */
  recentCommands: Record<string, string[]>;
};

export const EMPTY_TERMINAL_HISTORY: TerminalHistory = { running: [], recentCommands: {} };

/** Commands remembered per folder. */
export const MAX_RECENT_COMMANDS = 20;

/** Reads `terminals.json`; anything it cannot read is left out rather than failing. */
export function parseTerminalHistory(input: unknown): TerminalHistory {
  if (typeof input !== "object" || input === null) return { running: [], recentCommands: {} };
  const raw = input as { running?: unknown; recentCommands?: unknown };
  const running = Array.isArray(raw.running) ? raw.running.filter(isSavedTerminal) : [];
  const recentCommands: Record<string, string[]> = {};
  if (typeof raw.recentCommands === "object" && raw.recentCommands !== null) {
    for (const [folder, list] of Object.entries(raw.recentCommands)) {
      if (folder === "__proto__" || !Array.isArray(list)) continue;
      const commands = list.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      );
      if (commands.length > 0) recentCommands[folder] = commands.slice(0, MAX_RECENT_COMMANDS);
    }
  }
  return { running, recentCommands };
}

/** Puts `command` first in the folder's list, once, and keeps the newest `MAX_RECENT_COMMANDS`. */
export function rememberCommand(
  recent: Readonly<Record<string, readonly string[]>>,
  cwd: string,
  command: string,
): Record<string, string[]> {
  const wanted = command.trim();
  const copy: Record<string, string[]> = {};
  for (const [folder, list] of Object.entries(recent)) copy[folder] = [...list];
  if (wanted === "") return copy;
  const list = (copy[cwd] ?? []).filter((item) => item !== wanted);
  copy[cwd] = [wanted, ...list].slice(0, MAX_RECENT_COMMANDS);
  return copy;
}

function isSavedTerminal(value: unknown): value is SavedTerminal {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<SavedTerminal>;
  const optionalText = (field: unknown) => field === null || typeof field === "string";
  return (
    typeof item.command === "string" &&
    typeof item.cwd === "string" &&
    item.cwd !== "" &&
    typeof item.title === "string" &&
    typeof item.startedAt === "number" &&
    (item.startedBy === "program" || item.startedBy === "person") &&
    optionalText(item.project) &&
    optionalText(item.worktree) &&
    optionalText(item.branch)
  );
}
