import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { Button } from "../../../shared/ui/button.tsx";
import styles from "./detected-row.module.css";

type DetectedRowProps = {
  detected: DetectedPort;
  onName: () => void;
  onIgnore: () => void;
};

/** One port that answers HTTP but has no name: what runs there and the name Studio suggests. */
export function DetectedRow({ detected, onName, onIgnore }: DetectedRowProps) {
  const { port, processName, cwd, suggestedName } = detected;
  return (
    <li className={styles.row} data-port={port}>
      <span className={styles.port}>:{port}</span>

      <div className={styles.info}>
        {suggestedName ? (
          <span className={styles.suggestion} title="Suggested name">
            {suggestedName}
          </span>
        ) : (
          <span className={styles.noSuggestion}>No name suggested</span>
        )}
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

      <div className={styles.actions}>
        <Button size="xs" variant="ghost" aria-label={`Ignore port ${port}`} onClick={onIgnore}>
          Ignore
        </Button>
        <Button size="xs" variant="primary" aria-label={`Name port ${port}`} onClick={onName}>
          Name
        </Button>
      </div>
    </li>
  );
}
