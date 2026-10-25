import type { ReactNode } from "react";
import { directUrl } from "../../../../core/ports/direct-url.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import type { TerminalItemActions } from "./terminal-card.tsx";
import {
  clockTime,
  folderLabel,
  portUrl,
  starterText,
  stateOf,
  statusText,
} from "./terminal-groups.ts";
import styles from "./terminal-header.module.css";
import { TerminalStatusDot } from "./terminal-status-dot.tsx";
import { TerminalTitleField } from "./terminal-title-field.tsx";

type TerminalHeaderProps = {
  terminal: TerminalInfo;
  /** The rename field shows here when the list, which normally holds it, is hidden. */
  editing: boolean;
  fullScreen: boolean;
  /** Full screen can be left; on a narrow screen it is the only view. */
  canLeaveFullScreen: boolean;
  autoScroll: boolean;
  actions: TerminalItemActions;
  onCopyOutput: () => void;
  onToggleAutoScroll: () => void;
  onToggleFullScreen: () => void;
};

/**
 * The active terminal's header: title, status, command, folder and branch, the ports it opened
 * with Open and Copy, and its actions. In full screen a line of details follows (folder, start,
 * PID and who started it).
 */
export function TerminalHeader({
  terminal,
  editing,
  fullScreen,
  canLeaveFullScreen,
  autoScroll,
  actions,
  onCopyOutput,
  onToggleAutoScroll,
  onToggleFullScreen,
}: TerminalHeaderProps) {
  const { id, title } = terminal;
  const running = terminal.status === "running";
  const ports = terminal.ports ?? [];
  const starter = starterText(terminal);
  return (
    <div className={styles.header} data-full-screen={fullScreen ? "" : undefined}>
      <div className={styles.top}>
        <div className={styles.identity}>
          <TerminalStatusDot terminal={terminal} />
          {editing ? (
            <TerminalTitleField
              title={title}
              onDone={(value) => actions.onFinishEditing(id, value)}
            />
          ) : (
            <h2 className={styles.title} title={`${title}. Double-click or F2 to rename.`}>
              <button
                type="button"
                className={styles.titleButton}
                onDoubleClick={() => actions.onStartEditing(id)}
              >
                {title}
              </button>
            </h2>
          )}
          <span className={styles.status} data-status={stateOf(terminal)}>
            {statusText(terminal)}
          </span>
        </div>
        <div className={styles.actions}>
          <Action
            icon="pencil"
            label="Rename"
            title="Rename (F2)"
            onClick={() => actions.onStartEditing(id)}
          />
          {running ? <Action icon="power" label="Stop" onClick={() => actions.onStop(id)} /> : null}
          <Action
            icon="refresh"
            label={running ? "Restart" : "Run again"}
            onClick={() => actions.onRestart(id)}
          />
          {actions.editor ? (
            <Action
              icon="code"
              label="Open in editor"
              title={`Open the folder in ${actions.editor.name}`}
              onClick={() => actions.editor?.open(terminal.cwd)}
            />
          ) : null}
          <Action icon="copy" label="Copy output" onClick={onCopyOutput} />
          <Action
            icon="arrowDown"
            label="Auto-scroll"
            title="Keep the view at the newest output; scrolling up pauses it"
            pressed={autoScroll}
            onClick={onToggleAutoScroll}
          />
          {canLeaveFullScreen || !fullScreen ? (
            <Action
              icon={fullScreen ? "minimize" : "maximize"}
              label={fullScreen ? "Exit full screen" : "Full screen"}
              title={fullScreen ? "Exit full screen (Esc)" : "Full screen (Ctrl+Shift+F)"}
              pressed={fullScreen}
              onClick={onToggleFullScreen}
            />
          ) : null}
          <Action
            icon="x"
            label="Close the terminal"
            title="Close the terminal, stopping its command (Ctrl+Shift+W)"
            onClick={() => actions.onClose(id)}
          />
        </div>
      </div>
      <div className={styles.meta}>
        <code className={styles.command} title={terminal.command || "shell"}>
          {terminal.command || "shell"}
        </code>
        <span className={styles.folder} title={terminal.cwd}>
          <Icon name="folder" size={12} />
          {folderLabel(terminal)}
        </span>
        {terminal.branch ? (
          <span className={styles.branch}>
            <Icon name="branch" size={12} />
            {terminal.branch}
          </span>
        ) : null}
        {terminal.naming?.state === "named" ? (
          <span className={styles.named}>
            port {terminal.naming.port} is {terminal.naming.name}
          </span>
        ) : null}
        {ports.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not links.
          <span className={styles.ports} role="group" aria-label="Ports it opened">
            {ports.map((item) => (
              <span key={item.port} className={styles.port}>
                {item.route && item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className={styles.portLink}>
                    {item.route}
                  </a>
                ) : null}
                <a
                  href={directUrl(item.port)}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.portLink}
                >
                  {directUrl(item.port)}
                </a>
                <button
                  type="button"
                  className={styles.portCopy}
                  aria-label={`Copy ${portUrl(item)}`}
                  title={`Copy ${portUrl(item)}`}
                  onClick={() => actions.onCopyUrl(portUrl(item))}
                >
                  <Icon name="copy" size={11} />
                </button>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {fullScreen ? (
        <ul className={styles.details} aria-label="Terminal details">
          <Detail label="Folder" value={shortenPath(terminal.cwd)} />
          <Detail label="Started" value={clockTime(terminal.startedAt)} />
          {terminal.pid !== null ? <Detail label="PID" value={terminal.pid} /> : null}
          {starter ? <Detail label="Started by" value={starter} /> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <li className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </li>
  );
}

type ActionProps = {
  icon:
    | "pencil"
    | "power"
    | "refresh"
    | "code"
    | "copy"
    | "arrowDown"
    | "maximize"
    | "minimize"
    | "x";
  label: string;
  title?: string;
  pressed?: boolean;
  onClick: () => void;
};

/** A header action: icon and label, or only the icon when the header is narrow. */
function Action({ icon, label, title, pressed, onClick }: ActionProps) {
  return (
    <Button
      size="xs"
      variant="ghost"
      aria-label={label}
      title={title ?? label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      <span className={styles.actionLabel}>{label}</span>
    </Button>
  );
}
