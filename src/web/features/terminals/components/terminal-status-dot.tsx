import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { stateOf } from "./terminal-groups.ts";
import styles from "./terminal-status-dot.module.css";

/** Green while the command runs, red after a failure, amber when a Studio restart stopped it. */
export function TerminalStatusDot({ terminal }: { terminal: TerminalInfo }) {
  return <span className={styles.dot} data-status={stateOf(terminal)} aria-hidden="true" />;
}
