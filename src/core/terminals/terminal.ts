/**
 * A terminal Studio runs: one command in one project folder, with its output kept so the page,
 * the CLI and agents can read it. See docs/terminals.md.
 */

export type TerminalStatus = "running" | "exited";

/**
 * `pty`: the command runs in a pseudo-terminal (through the system `script` command), so it sees a
 * real terminal, colors and prompts work and Ctrl+C reaches it. `pipes`: plain stdin/stdout, with
 * colors forced through `FORCE_COLOR`; used on Windows and where `script` is missing.
 */
export type TerminalMode = "pty" | "pipes";

/** Naming the port the command opens, asked for by `portless-studio run`. */
export type TerminalNaming = {
  /** `waiting` for a new port in the folder, `named` once it has a route, `failed` otherwise. */
  state: "waiting" | "named" | "failed";
  /** The name asked for; null means the name Studio suggests for the port. */
  requested: string | null;
  /** The route name the port got. */
  name: string | null;
  port: number | null;
  /** Why naming failed. */
  message?: string;
};

export type TerminalInfo = {
  /** Short and unique for this Studio run, e.g. `t3`. */
  id: string;
  title: string;
  /** Absolute folder the command runs in. */
  cwd: string;
  /** What runs; empty for the interactive shell. */
  command: string;
  /** The project the folder belongs to, for grouping tabs; null when Studio does not know it. */
  project: string | null;
  status: TerminalStatus;
  /** Exit code once exited; null while running or when a signal ended it. */
  exitCode: number | null;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt: number | null;
  pid: number | null;
  mode: TerminalMode;
  /** Size the command was started with. */
  cols: number;
  rows: number;
  /** Offset just past the newest output character; read with `?from=` to get only newer output. */
  nextSeq: number;
  naming: TerminalNaming | null;
};

// Control sequences: CSI (colors, cursor), OSC (window title) and two-character escapes.
const ESCAPES = new RegExp(
  [
    String.raw`\u001b\[[0-?]*[ -/]*[@-~]`,
    String.raw`\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)`,
    String.raw`\u001b[@-Z\\-_]`,
  ].join("|"),
  "g",
);
// Every other control character except tab and newline.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Terminal output as plain text for agents and the clipboard: no escape codes, LF line ends, and
 * a line redrawn with a carriage return (a progress bar) keeps only its last version.
 */
export function plainText(raw: string): string {
  return raw
    .replace(ESCAPES, "")
    .replace(/\r+\n/g, "\n")
    .split("\n")
    .map((line) => {
      const parts = line.split("\r").filter((part) => part !== "");
      return (parts.at(-1) ?? "").replace(CONTROLS, "");
    })
    .join("\n");
}
