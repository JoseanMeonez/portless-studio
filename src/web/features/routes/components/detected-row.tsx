import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { processUptime } from "../../../shared/lib/uptime-label.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import styles from "./detected-row.module.css";
import { DirectUrl } from "./direct-url.tsx";
import { ProjectLocation } from "./project-location.tsx";
import type { RowEditor } from "./route-row.tsx";
import { type MenuPoint, rowMenuTrigger } from "./row-menu-trigger.ts";
import type { RowTerminal } from "./row-terminal.ts";
import { RowTerminalActions } from "./row-terminal-actions.tsx";
import { RowTerminalStatus } from "./row-terminal-status.tsx";

type DetectedRowProps = {
  detected: DetectedPort;
  /** The row asks "Stop this server?" instead of showing its actions. */
  confirmingStop: boolean;
  onName: () => void;
  onIgnore: () => void;
  /** Shown only when the pid or the container is known. */
  onRequestStop: () => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
  /** Right-click or Ctrl+click: the menu with open with, copy path and more. */
  onMenu: (point: MenuPoint) => void;
  /** Copies the direct URL of the row's port or of one of its extra ports. */
  onCopyDirectUrl: (port: number) => void;
  /** Shows the terminal running this server, or opens a shell in its folder; hidden without it. */
  onOpenTerminal?: (() => void) | undefined;
  /** The Studio terminal serving this port: a status chip and its actions. */
  terminal?: RowTerminal | null | undefined;
  /** Epoch milliseconds the uptime counts to. */
  now: number;
  /** Opens the port's folder in the default editor; hidden without it. */
  editor?: RowEditor | null | undefined;
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
  onMenu,
  onCopyDirectUrl,
  onOpenTerminal,
  terminal,
  now,
  editor,
}: DetectedRowProps) {
  const { port, pid, processName, cwd, suggestedName, container } = detected;
  const uptime = processUptime(detected.startedAt, now);
  const stopTarget = container ? `container ${container.name}` : processName || "the server";
  return (
    <li className={styles.row} data-port={port} {...rowMenuTrigger(onMenu)}>
      <span className={styles.portCell} data-cell="port">
        <span className={styles.port}>:{port}</span>
        <span className={styles.uptime} data-cell="uptime" title={uptime.title || undefined}>
          {uptime.text}
        </span>
      </span>

      <div className={styles.info} data-cell="info">
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
          {terminal ? <RowTerminalStatus terminal={terminal} label={`port ${port}`} /> : null}
        </span>
        <span className={styles.process}>
          {container ? (
            <>
              <Badge tone="accent" className={styles.docker}>
                Docker
              </Badge>
              <span className={styles.folder} title={`Container ${container.name}`}>
                {container.image}
              </span>
            </>
          ) : (
            <span className={styles.processName}>{processName}</span>
          )}
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
        <ProjectLocation project={detected.project} showPath={false} />
        <DirectUrl port={port} onCopy={() => onCopyDirectUrl(port)} />
        {detected.extraPorts && detected.extraPorts.length > 0 ? (
          <span className={styles.extraPorts}>
            <span>Also answers on</span>
            {detected.extraPorts.map((extra) => (
              <DirectUrl key={extra} port={extra} onCopy={() => onCopyDirectUrl(extra)} />
            ))}
          </span>
        ) : null}
      </div>

      {confirmingStop ? (
        <div className={styles.actions}>
          <span className={styles.confirmText}>
            Stop {stopTarget} on :{port}?
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
          {editor ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Open port ${port} in ${editor.name}`}
              title={`Open in ${editor.name}`}
              onClick={editor.onOpen}
            >
              <Icon name="code" size={14} />
            </Button>
          ) : null}
          {terminal ? (
            <RowTerminalActions terminal={terminal} label={`port ${port}`} />
          ) : onOpenTerminal ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Open a terminal for port ${port}`}
              title="Terminal"
              onClick={onOpenTerminal}
            >
              <Icon name="terminal" size={14} />
            </Button>
          ) : null}
          {(pid !== null || container) && !terminal?.running ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Stop the ${container ? "container" : "server"} on port ${port}`}
              title={container ? `Stop ${stopTarget}` : `Stop ${stopTarget} (pid ${pid})`}
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
