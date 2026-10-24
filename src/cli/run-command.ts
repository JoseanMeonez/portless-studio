import {
  API_PATHS,
  type CreateTerminalRequest,
  TERMINAL_OUTPUT_EVENT,
  TERMINAL_STATUS_EVENT,
  type TerminalOutputChunk,
} from "../core/api/contract.ts";
import type { TerminalInfo } from "../core/terminals/terminal.ts";
import type { StudioClient } from "./mcp/studio-client.ts";

export type RunCommandOptions = {
  client: StudioClient;
  /** Absolute folder to run in. */
  cwd: string;
  /** The command and its arguments as typed after `--`. */
  argv: string[];
  /** Name for the port it opens; null for the suggested one. */
  name: string | null;
  platform: NodeJS.Platform;
  /** Size of the caller's terminal, so the command draws for it. */
  columns?: number | undefined;
  rows?: number | undefined;
  /** Writes the command's output as it comes, escape codes included. */
  write(text: string): void;
  /** One line about the run itself, kept apart from the command's output (stderr). */
  note(line: string): void;
  /** Registers what Ctrl+C does. */
  onInterrupt(handler: () => void): void;
};

/** Exit code after Ctrl+C, like a shell reports for SIGINT. */
const INTERRUPTED = 130;

/**
 * `portless-studio run -- <command>`: asks the running Studio to run the command in a terminal,
 * so its output also shows in the dashboard, names the first port it opens, and prints its output
 * here until it ends. Ctrl+C stops it; a second Ctrl+C leaves at once. Returns the exit code.
 */
export async function runInStudio(options: RunCommandOptions): Promise<number> {
  const request: CreateTerminalRequest = {
    cwd: options.cwd,
    command: commandLine(options.argv, options.platform),
    name: options.name ?? true,
    ...(options.columns ? { cols: options.columns } : {}),
    ...(options.rows ? { rows: options.rows } : {}),
  };
  const created = await options.client.write("POST", API_PATHS.terminals, request);
  if (!created.ok) {
    options.note(`Error: ${created.error.message}`);
    return 1;
  }
  const terminal = created.value as TerminalInfo;
  options.note(
    `portless-studio: running in Studio terminal ${terminal.id}; watch it at ${options.client.baseUrl}/?terminal=${terminal.id}`,
  );

  return new Promise<number>((resolve) => {
    let interrupted = false;
    let reportedNaming = false;
    let finished = false;
    let close = () => {};
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      close();
      resolve(code);
    };
    options.onInterrupt(() => {
      if (interrupted) {
        finish(INTERRUPTED);
        return;
      }
      interrupted = true;
      options.note("portless-studio: stopping it (Ctrl+C again to leave now)");
      void options.client.write("POST", API_PATHS.terminalStop(terminal.id));
    });

    const onStatus = (info: TerminalInfo) => {
      const naming = info.naming;
      if (naming && naming.state !== "waiting" && !reportedNaming) {
        reportedNaming = true;
        options.note(
          naming.state === "named"
            ? `portless-studio: port ${naming.port} is now "${naming.name}"`
            : `portless-studio: the port was not named: ${naming.message ?? "unknown reason"}`,
        );
      }
      if (info.status === "exited") {
        finish(interrupted ? INTERRUPTED : (info.exitCode ?? 1));
      }
    };

    void options.client
      .stream(
        `${API_PATHS.terminalStream(terminal.id)}?from=0`,
        (type, data) => {
          if (type === TERMINAL_OUTPUT_EVENT) options.write((data as TerminalOutputChunk).data);
          else if (type === TERMINAL_STATUS_EVENT) onStatus(data as TerminalInfo);
        },
        () => {
          if (finished) return;
          options.note("portless-studio: Studio closed the terminal or stopped.");
          finish(1);
        },
      )
      .then((opened) => {
        if (!opened.ok) {
          options.note(`Error: ${opened.error.message}`);
          finish(1);
          return;
        }
        close = opened.value.close;
        if (finished) close();
      });
  });
}

/**
 * One shell command from the words after `--`. A single word is used as written, so
 * `run -- "pnpm dev && pnpm test"` keeps its `&&`; several words are quoted where needed so each
 * stays one argument.
 */
export function commandLine(argv: readonly string[], platform: NodeJS.Platform): string {
  if (argv.length === 1) return argv[0] ?? "";
  return argv.map((word) => quoteWord(word, platform)).join(" ");
}

function quoteWord(word: string, platform: NodeJS.Platform): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  if (platform === "win32") return `"${word.replaceAll('"', '\\"')}"`;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}
