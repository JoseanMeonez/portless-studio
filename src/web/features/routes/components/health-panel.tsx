import { useState } from "react";
import type { StudioAction } from "../../../../core/api/contract.ts";
import type { DoctorCheck, DoctorStatus } from "../../../../core/doctor/doctor-check.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import { CopyCommand } from "./copy-command.tsx";
import styles from "./health-panel.module.css";

type HealthPanelProps = {
  checks: readonly DoctorCheck[] | null;
  /** Why the checks could not be loaded. */
  error: string | null;
  /** Id of the check whose fix is running. */
  fixing: string | null;
  studioBusy: StudioAction | null;
  onFix: (id: string) => void;
  onCopy: (command: string) => void;
  onRefresh: () => void;
  onRestartStudio: () => void;
  onStopStudio: () => void;
  onClose: () => void;
};

const TONES: Record<DoctorStatus, "success" | "warning" | "danger"> = {
  ok: "success",
  warn: "warning",
  fail: "danger",
};
const STATUS_LABELS: Record<DoctorStatus, string> = { ok: "OK", warn: "Warning", fail: "Problem" };

/** What Studio checked on this machine, each problem with its fix, and Studio's own controls. */
export function HealthPanel({
  checks,
  error,
  fixing,
  studioBusy,
  onFix,
  onCopy,
  onRefresh,
  onRestartStudio,
  onStopStudio,
  onClose,
}: HealthPanelProps) {
  const [confirmingStop, setConfirmingStop] = useState(false);

  return (
    <Dialog
      title="Health"
      description="What Studio checked on this machine, and how to fix what is wrong."
      size="lg"
      onClose={onClose}
    >
      <div className={styles.body}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {checks === null && !error ? <p className={styles.loading}>Running the checks…</p> : null}

        {checks ? (
          <ul className={styles.checks} aria-label="Checks">
            {checks.map((check) => (
              <li key={check.id} className={styles.check} data-status={check.status}>
                <span className={styles.dot}>
                  <StatusDot tone={TONES[check.status]} label={STATUS_LABELS[check.status]} />
                </span>
                <div className={styles.text}>
                  <p className={styles.title}>{check.title}</p>
                  <p className={styles.detail}>{check.detail}</p>
                  {check.fix?.action ? (
                    <div>
                      <Button
                        size="sm"
                        variant={check.status === "ok" ? "secondary" : "primary"}
                        disabled={fixing !== null}
                        onClick={() => onFix(check.id)}
                      >
                        {fixing === check.id ? "Working…" : check.fix.label}
                      </Button>
                    </div>
                  ) : check.fix?.command ? (
                    <CopyCommand
                      command={check.fix.command}
                      description={check.fix.label}
                      onCopy={onCopy}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <section className={styles.studio} aria-labelledby="studio-controls-title">
          <h3 id="studio-controls-title" className={styles.sectionTitle}>
            Studio
          </h3>
          {confirmingStop ? (
            <div className={styles.studioRow}>
              <p className={styles.detail}>
                Stop Studio? This page stops working until you start it again.
              </p>
              <div className={styles.buttons}>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingStop(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" onClick={onStopStudio} autoFocus>
                  Yes, stop Studio
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.studioRow}>
              <p className={styles.detail}>Restart Studio to apply a new port, or stop it.</p>
              <div className={styles.buttons}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={studioBusy !== null}
                  onClick={onRestartStudio}
                >
                  {studioBusy === "restart" ? "Restarting…" : "Restart Studio"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={studioBusy !== null}
                  onClick={() => setConfirmingStop(true)}
                >
                  Stop Studio
                </Button>
              </div>
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            Run the checks again
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
