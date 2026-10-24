import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Switch } from "../../../shared/ui/switch.tsx";
import { DetectedRow } from "./detected-row.tsx";
import styles from "./detected-section.module.css";
import type { MenuPoint } from "./row-menu-trigger.ts";

type DetectedSectionProps = {
  /** The detected ports the filter leaves visible. */
  detected: readonly DetectedPort[];
  totalCount: number;
  autoName: boolean;
  autoNameSaving: boolean;
  namingAll: boolean;
  onAutoNameChange: (enabled: boolean) => void;
  onName: (detected: DetectedPort) => void;
  onIgnore: (detected: DetectedPort) => void;
  onNameAll: () => void;
  /** Port whose row asks to confirm stopping its server. */
  confirmingStop: number | null;
  onRequestStop: (detected: DetectedPort) => void;
  onConfirmStop: (detected: DetectedPort) => void;
  onCancelStop: () => void;
  onMenu: (detected: DetectedPort, point: MenuPoint) => void;
};

/** Dev servers found on this machine that portless does not know yet, ready to be named. */
export function DetectedSection({
  detected,
  totalCount,
  autoName,
  autoNameSaving,
  namingAll,
  onAutoNameChange,
  onName,
  onIgnore,
  onNameAll,
  confirmingStop,
  onRequestStop,
  onConfirmStop,
  onCancelStop,
  onMenu,
}: DetectedSectionProps) {
  const suggested = detected.filter((item) => item.suggestedName !== null).length;
  const count =
    detected.length === totalCount ? `${totalCount}` : `${detected.length} of ${totalCount}`;

  return (
    <section className={styles.section} aria-labelledby="detected-title">
      <header className={styles.header}>
        <div className={styles.intro}>
          <h2 id="detected-title" className={styles.title}>
            <Icon name="radar" size={14} className={styles.titleIcon} />
            Detected on this machine
            <Badge className={styles.count}>{count}</Badge>
          </h2>
          <p className={styles.text}>
            These ports answer HTTP but have no name yet. Name one to open it at its own URL.
          </p>
        </div>
        <div className={styles.controls}>
          <Switch
            label="Auto-name new servers"
            checked={autoName}
            disabled={autoNameSaving}
            onChange={onAutoNameChange}
            className={styles.autoSwitch}
          />
          {suggested >= 2 ? (
            <Button size="sm" variant="secondary" disabled={namingAll} onClick={onNameAll}>
              {namingAll ? "Naming…" : "Name all"}
            </Button>
          ) : null}
        </div>
      </header>

      <ul className={styles.list} aria-label="Detected ports">
        {detected.map((item) => (
          <DetectedRow
            key={item.port}
            detected={item}
            confirmingStop={confirmingStop === item.port}
            onName={() => onName(item)}
            onIgnore={() => onIgnore(item)}
            onRequestStop={() => onRequestStop(item)}
            onConfirmStop={() => onConfirmStop(item)}
            onMenu={(point) => onMenu(item, point)}
            onCancelStop={onCancelStop}
          />
        ))}
      </ul>
    </section>
  );
}
