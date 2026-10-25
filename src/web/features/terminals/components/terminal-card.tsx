import type { KeyboardEvent } from "react";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { formatUptime } from "../../../shared/lib/format-uptime.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./terminal-card.module.css";
import {
  clockTime,
  folderLabel,
  portLabel,
  portUrl,
  shortStatus,
  stateOf,
} from "./terminal-groups.ts";
import { TerminalStatusDot } from "./terminal-status-dot.tsx";
import { TerminalTitleField } from "./terminal-title-field.tsx";

/** What a person can do to one terminal, from its card or the header. */
export type TerminalItemActions = {
  onSelect: (id: string) => void;
  onStartEditing: (id: string) => void;
  /** null leaves the title as it was; an empty title gives back the default one. */
  onFinishEditing: (id: string, title: string | null) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onClose: (id: string) => void;
  onCopyUrl: (url: string) => void;
  /** Opens the folder in the default editor; absent when no editor was found. */
  editor: { name: string; open: (folder: string) => void } | null;
};

type TerminalCardProps = {
  terminal: TerminalInfo;
  active: boolean;
  editing: boolean;
  now: number;
  actions: TerminalItemActions;
  /** Arrow keys on the card: -1 for the previous one, 1 for the next. */
  onMove: (id: string, step: -1 | 1) => void;
  /** Enter on the card: show this terminal and put the keyboard in it. */
  onEnter: (id: string) => void;
};

/**
 * One terminal in the list: status, title, command, folder and branch, the ports it opened and
 * its uptime. Hover or focus shows its actions and a line of details (folder, start, PID, exit).
 */
export function TerminalCard({
  terminal,
  active,
  editing,
  now,
  actions,
  onMove,
  onEnter,
}: TerminalCardProps) {
  const { id, title } = terminal;
  const command = terminal.command || "shell";
  const running = terminal.status === "running";
  const ports = terminal.ports ?? [];
  const firstPort = ports[0];
  const uptime = running ? formatUptime(terminal.startedAt, now) : null;
  const keys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      onMove(id, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      onEnter(id);
    } else {
      return;
    }
    event.preventDefault();
  };
  return (
    <div className={styles.card} data-terminal={id} data-active={active ? "" : undefined}>
      {editing ? (
        <div className={styles.rename}>
          <TerminalTitleField
            title={title}
            onDone={(value) => actions.onFinishEditing(id, value)}
          />
        </div>
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          aria-label={title}
          aria-description={`${command}, ${shortStatus(terminal)}`}
          tabIndex={active ? 0 : -1}
          className={styles.main}
          onClick={() => actions.onSelect(id)}
          onDoubleClick={() => actions.onStartEditing(id)}
          onKeyDown={keys}
        >
          <span className={styles.titleLine}>
            <TerminalStatusDot terminal={terminal} />
            <span className={styles.title}>{title}</span>
            {uptime ? <span className={styles.uptime}>{uptime}</span> : null}
          </span>
          <span className={styles.statusLine}>
            <span className={styles.status} data-status={stateOf(terminal)}>
              {shortStatus(terminal)}
            </span>
            <code className={styles.command}>{command}</code>
          </span>
          <span className={styles.folderLine}>
            <span className={styles.folder}>{folderLabel(terminal)}</span>
            {terminal.branch ? (
              <span className={styles.branch}>
                <Icon name="branch" size={11} />
                {terminal.branch}
              </span>
            ) : null}
          </span>
        </button>
      )}
      {ports.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not links.
        <span className={styles.ports} role="group" aria-label={`Ports of ${title}`}>
          {ports.map((item) => (
            <a
              key={item.port}
              className={styles.port}
              href={portUrl(item)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${portUrl(item)}`}
            >
              {portLabel(item)}
            </a>
          ))}
        </span>
      ) : null}
      <dl className={styles.details} data-testid="terminal-details">
        <div className={styles.detail}>
          <dt>Folder</dt>
          <dd title={terminal.cwd}>{shortenPath(terminal.cwd)}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Started</dt>
          <dd>{clockTime(terminal.startedAt)}</dd>
        </div>
        {terminal.pid !== null ? (
          <div className={styles.detail}>
            <dt>PID</dt>
            <dd>{terminal.pid}</dd>
          </div>
        ) : null}
        {!running && terminal.exitCode !== null ? (
          <div className={styles.detail}>
            <dt>Exit code</dt>
            <dd>{terminal.exitCode}</dd>
          </div>
        ) : null}
      </dl>
      <div className={styles.actions}>
        <CardAction
          icon="refresh"
          label={running ? `Restart ${title}` : `Run ${title} again`}
          onClick={() => actions.onRestart(id)}
        />
        {running ? (
          <CardAction icon="power" label={`Stop ${title}`} onClick={() => actions.onStop(id)} />
        ) : null}
        {actions.editor ? (
          <CardAction
            icon="code"
            label={`Open ${title} in ${actions.editor.name}`}
            onClick={() => actions.editor?.open(terminal.cwd)}
          />
        ) : null}
        {firstPort ? (
          <CardAction
            icon="copy"
            label={`Copy the URL of ${title}`}
            onClick={() => actions.onCopyUrl(portUrl(firstPort))}
          />
        ) : null}
        <CardAction
          icon="pencil"
          label={`Rename ${title}`}
          onClick={() => actions.onStartEditing(id)}
        />
        <CardAction icon="x" label={`Close ${title}`} onClick={() => actions.onClose(id)} />
      </div>
    </div>
  );
}

function CardAction({
  icon,
  label,
  onClick,
}: {
  icon: "refresh" | "power" | "code" | "copy" | "pencil" | "x";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.action}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}
