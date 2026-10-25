import { type RowTerminal, rowTerminalStatus } from "./row-terminal.ts";
import styles from "./row-terminal-status.module.css";

/** A small always-visible chip on a row whose server runs in a Studio terminal; click for logs. */
export function RowTerminalStatus({ terminal, label }: { terminal: RowTerminal; label: string }) {
  const status = rowTerminalStatus(terminal);
  return (
    <button
      type="button"
      className={styles.chip}
      data-status={terminal.running ? "running" : terminal.exitCode ? "failed" : "stopped"}
      aria-label={`Terminal of ${label}: ${status}. Show its logs`}
      title={`${terminal.title}: ${status}. Show its logs`}
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={terminal.onShow}
    >
      <span className={styles.dot} aria-hidden="true" />
      {status}
    </button>
  );
}
