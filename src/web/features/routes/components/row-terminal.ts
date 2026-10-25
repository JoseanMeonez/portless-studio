/** The Studio terminal whose processes serve a row's port, with what the row can do to it. */
export type RowTerminal = {
  title: string;
  running: boolean;
  /** Exit code once ended; null while running or when a signal or a Studio restart ended it. */
  exitCode: number | null;
  /** Shows the terminal and its output. */
  onShow: () => void;
  onStop: () => void;
  onRunAgain: () => void;
};

/** `running`, `exited 1`, `stopped`. */
export function rowTerminalStatus(terminal: RowTerminal): string {
  if (terminal.running) return "running";
  return terminal.exitCode === null ? "stopped" : `exited ${terminal.exitCode}`;
}
