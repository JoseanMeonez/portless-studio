import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import type { OtherPort } from "../../../../core/ports/helper-ports.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Switch } from "../../../shared/ui/switch.tsx";
import { DetectedOtherPorts } from "./detected-other-ports.tsx";
import { DetectedRow } from "./detected-row.tsx";
import styles from "./detected-section.module.css";
import type { RowEditor } from "./route-row.tsx";
import type { MenuPoint } from "./row-menu-trigger.ts";
import type { RowTerminal } from "./row-terminal.ts";

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
  /** Copies `http://localhost:<port>` for a row's port, one of its extra ports or an other port. */
  onCopyDirectUrl: (port: number) => void;
  /** Helper ports, debuggers and temporary ports, listed under a closed "Other ports". */
  otherPorts: readonly OtherPort[];
  /** The whole section is folded down to its title. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  otherPortsOpen: boolean;
  onToggleOtherPorts: () => void;
  /** Absent hides the terminal button; so does `null` for one port. */
  terminalFor?: ((detected: DetectedPort) => (() => void) | null) | undefined;
  /** The Studio terminal serving a port, if any. */
  rowTerminalFor?: ((detected: DetectedPort) => RowTerminal | null) | undefined;
  /** Epoch milliseconds the uptimes count to. */
  now: number;
  /** The default editor button of a port; null hides it. */
  editorFor?: ((detected: DetectedPort) => RowEditor | null) | undefined;
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
  onCopyDirectUrl,
  otherPorts,
  collapsed,
  onToggleCollapsed,
  otherPortsOpen,
  onToggleOtherPorts,
  terminalFor,
  rowTerminalFor,
  now,
  editorFor,
}: DetectedSectionProps) {
  const suggested = detected.filter((item) => item.suggestedName !== null).length;
  const count =
    detected.length === totalCount ? `${totalCount}` : `${detected.length} of ${totalCount}`;

  return (
    <section className={styles.section} aria-labelledby="detected-title">
      <header className={styles.header}>
        <div className={styles.intro}>
          <h2 id="detected-title" className={styles.title}>
            <button
              type="button"
              className={styles.collapse}
              aria-expanded={!collapsed}
              aria-controls={collapsed ? undefined : "detected-body"}
              onClick={onToggleCollapsed}
            >
              <Icon
                name="chevronDown"
                size={14}
                className={collapsed ? `${styles.chevron} ${styles.closed}` : styles.chevron}
              />
              <Icon name="radar" size={14} className={styles.titleIcon} />
              Detected on this machine
              <Badge className={styles.count}>{count}</Badge>
            </button>
          </h2>
          {collapsed ? null : (
            <p className={styles.text}>
              These ports answer HTTP but have no name yet. Name one to open it at its own URL.
            </p>
          )}
        </div>
        {collapsed ? null : (
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
        )}
      </header>

      {collapsed ? null : (
        <div id="detected-body" className={styles.body}>
          {detected.length > 0 ? (
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
                  onCopyDirectUrl={onCopyDirectUrl}
                  onOpenTerminal={terminalFor?.(item) ?? undefined}
                  terminal={rowTerminalFor?.(item) ?? null}
                  now={now}
                  editor={editorFor?.(item) ?? null}
                  onCancelStop={onCancelStop}
                />
              ))}
            </ul>
          ) : null}
          <DetectedOtherPorts
            ports={otherPorts}
            open={otherPortsOpen}
            onToggle={onToggleOtherPorts}
            onCopyDirectUrl={onCopyDirectUrl}
          />
        </div>
      )}
    </section>
  );
}
