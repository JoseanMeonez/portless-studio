import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import styles from "./detected-row.module.css";

type DetectedRowProps = {
  detected: DetectedPort;
  /** The row asks "Stop this server?" instead of showing its actions. */
  confirmingStop: boolean;
  onName: () => void;
  onIgnore: () => void;
  /** Shown only when the pid is known. */
  onRequestStop: () => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
};

/** One port that answers HTTP but has no name: what runs there and the name Studio suggests. */
export function DetectedRow({
  detected,
  confirmingStop,
  onName,
  onIgnore,
  onRequestStop,
  onConfirmStop,
  onCancelStop,
}: DetectedRowProps) {
  const { port, pid, processName, cwd, suggestedName } = detected;
  return (
    <li className={styles.row} data-port={port}>
      <span className={styles.port}>:{port}</span>

      <div className={styles.info}>
        <span className={styles.titleLine}>
          <ItemIcon
            icon={detected.icon}
            name={detected.project?.name ?? suggestedName ?? processName}
          />
          {suggestedName ? (
            <span className={styles.suggestion} title="Suggested name">
              {suggestedName}
            </span>
          ) : (
            <span className={styles.noSuggestion}>No name suggested</span>
          )}
        </span>
        <span className={styles.process}>
          <span className={styles.processName}>{processName}</span>
          {cwd ? (
            <>
              <span aria-hidden="true" className={styles.separator}>
                ·
              </span>
              <span className={styles.folder} title={cwd}>
                {shortenPath(cwd)}
              </span>
            </>
          ) : null}
        </span>
      </div>

      {confirmingStop ? (
        <div className={styles.actions}>
          <span className={styles.confirmText}>
            Stop {processName || "the server"} on :{port}?
          </span>
          <Button size="xs" variant="ghost" onClick={onCancelStop}>
            Cancel
          </Button>
          <Button size="xs" variant="danger" onClick={onConfirmStop} autoFocus>
            Stop
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          {pid !== null ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Stop the server on port ${port}`}
              title={`Stop ${processName || "the server"} (pid ${pid})`}
              onClick={onRequestStop}
            >
              <Icon name="power" size={14} />
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" aria-label={`Ignore port ${port}`} onClick={onIgnore}>
            Ignore
          </Button>
          <Button size="xs" variant="primary" aria-label={`Name port ${port}`} onClick={onName}>
            Name
          </Button>
        </div>
      )}
    </li>
  );
}
