import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import type { ConnectionState } from "../data/routes-gateway.ts";
import styles from "./connection-indicator.module.css";

const LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
};

/** Whether the list is receiving live updates from the server. */
export function ConnectionIndicator({ state }: { state: ConnectionState }) {
  return (
    <span className={styles.indicator} role="status" aria-label={`Live updates: ${LABELS[state]}`}>
      <StatusDot tone={state === "open" ? "success" : "warning"} pulse={state !== "open"} />
      <span aria-hidden="true">{LABELS[state]}</span>
    </span>
  );
}
