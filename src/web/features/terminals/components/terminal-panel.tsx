import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { directUrl } from "../../../../core/ports/direct-url.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import type { TerminalDock } from "../hooks/use-terminal-panel.ts";
import styles from "./terminal-panel.module.css";

type TerminalPanelProps = {
  terminals: readonly TerminalInfo[];
  active: TerminalInfo | null;
  dock: TerminalDock;
  size: number;
  follow: boolean;
  /** The terminal view, or the new-terminal form. */
  children: ReactNode;
  onSelect: (id: string) => void;
  /** An empty title gives back the default one. */
  onRename: (id: string, title: string) => void;
  onCloseTerminal: (id: string) => void;
  onNew: () => void;
  onStop: () => void;
  onRestart: () => void;
  onToggleFollow: () => void;
  onCopy: () => void;
  onToggleDock: () => void;
  onResize: (size: number) => void;
  onClose: () => void;
};

const RESIZE_STEP = 24;

/**
 * The docked terminal panel: tabs grouped by project and worktree, the active terminal's status,
 * controls and the ports it opened, and its screen. Double-click a tab or press F2 to rename it.
 * A handle on its inner edge resizes it; below 640 px it covers the page.
 */
export function TerminalPanel({
  terminals,
  active,
  dock,
  size,
  follow,
  children,
  onSelect,
  onRename,
  onCloseTerminal,
  onNew,
  onStop,
  onRestart,
  onToggleFollow,
  onCopy,
  onToggleDock,
  onResize,
  onClose,
}: TerminalPanelProps) {
  const dragging = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Enter and Escape settle the edit; the blur that follows must not apply it again.
  const settled = useRef(false);
  const startEditing = (id: string) => {
    settled.current = false;
    setEditingId(id);
  };
  const finishEditing = (id: string, title: string | null) => {
    if (settled.current) return;
    settled.current = true;
    if (title !== null) onRename(id, title);
    setEditingId(null);
  };
  // F2 renames even from inside the terminal screen, which would otherwise send it to the shell.
  const renameWithF2 = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "F2" || !active || editingId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    startEditing(active.id);
  };
  const sizeFrom = (event: PointerEvent) =>
    dock === "bottom" ? window.innerHeight - event.clientY : window.innerWidth - event.clientX;
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onResize(sizeFrom(event));
  };
  const endDrag = () => {
    dragging.current = false;
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = dock === "bottom" ? "ArrowUp" : "ArrowLeft";
    const shrink = dock === "bottom" ? "ArrowDown" : "ArrowRight";
    if (event.key === grow) onResize(size + RESIZE_STEP);
    else if (event.key === shrink) onResize(size - RESIZE_STEP);
    else return;
    event.preventDefault();
  };

  const running = active?.status === "running";
  return (
    <section
      className={styles.panel}
      data-dock={dock}
      style={{ "--panel-size": `${size}px` } as CSSProperties}
      aria-label="Terminals"
      onKeyDownCapture={renameWithF2}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element. */}
      <div
        className={styles.handle}
        role="separator"
        tabIndex={0}
        aria-orientation={dock === "bottom" ? "horizontal" : "vertical"}
        aria-label="Resize the terminal panel"
        aria-valuenow={size}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeWithKeys}
      />
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Open terminals">
          {groupByWorktree(terminals).map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not tabs.
            <div key={group.name} className={styles.group} role="group" aria-label={group.name}>
              <span className={styles.groupName} title={group.path}>
                {group.name}
                {group.branch ? <span className={styles.groupBranch}>{group.branch}</span> : null}
              </span>
              {group.terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className={styles.tab}
                  data-active={terminal.id === active?.id ? "" : undefined}
                >
                  {editingId === terminal.id ? (
                    <input
                      className={styles.tabInput}
                      aria-label={`Rename ${terminal.title}`}
                      defaultValue={terminal.title}
                      maxLength={60}
                      // biome-ignore lint/a11y/noAutofocus: the field appears because the person asked to rename.
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          finishEditing(terminal.id, event.currentTarget.value);
                        } else if (event.key === "Escape") {
                          event.stopPropagation();
                          finishEditing(terminal.id, null);
                        }
                      }}
                      onBlur={(event) => {
                        const title = event.currentTarget.value;
                        finishEditing(terminal.id, title === terminal.title ? null : title);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={terminal.id === active?.id}
                      className={styles.tabButton}
                      onClick={() => onSelect(terminal.id)}
                      onDoubleClick={() => startEditing(terminal.id)}
                      title={`${terminal.command || "shell"} in ${terminal.cwd}. Double-click or F2 to rename.`}
                    >
                      <span
                        className={styles.dot}
                        data-status={statusOf(terminal)}
                        aria-hidden="true"
                      />
                      <span className={styles.tabTitle}>{terminal.title}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.tabClose}
                    aria-label={`Close ${terminal.title}`}
                    onClick={() => onCloseTerminal(terminal.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <Button size="xs" variant="ghost" onClick={onNew}>
            <Icon name="plus" size={14} />
            New terminal
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={dock === "bottom" ? "Dock on the right" : "Dock at the bottom"}
            title={dock === "bottom" ? "Dock on the right" : "Dock at the bottom"}
            onClick={onToggleDock}
            className={styles.dockToggle}
          >
            <Icon name="layers" size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label="Hide terminals"
            title="Hide terminals"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </Button>
        </div>
      </header>
      {active ? (
        <div className={styles.toolbar}>
          <span className={styles.status} data-status={statusOf(active)}>
            {running
              ? "Running"
              : active.exitCode === null
                ? "Stopped"
                : `Exited with code ${active.exitCode}`}
          </span>
          <code className={styles.command} title={active.cwd}>
            {active.command || "shell"}
          </code>
          {active.naming?.state === "named" ? (
            <span className={styles.named}>
              port {active.naming.port} is {active.naming.name}
            </span>
          ) : null}
          {(active.ports ?? []).length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not links.
            <span className={styles.ports} role="group" aria-label="Ports it opened">
              {(active.ports ?? []).map((item) => (
                <span key={item.port} className={styles.portLinks}>
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
                </span>
              ))}
            </span>
          ) : null}
          <div className={styles.toolbarActions}>
            <Button
              size="xs"
              variant="ghost"
              title="Rename (F2)"
              onClick={() => startEditing(active.id)}
            >
              <Icon name="pencil" size={14} />
              Rename
            </Button>
            {running ? (
              <Button size="xs" variant="ghost" onClick={onStop}>
                <Icon name="power" size={14} />
                Stop
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={onRestart}>
              <Icon name="refresh" size={14} />
              {running ? "Restart" : "Run again"}
            </Button>
            <Button size="xs" variant="ghost" aria-pressed={follow} onClick={onToggleFollow}>
              <Icon name="sortDown" size={14} />
              Follow
            </Button>
            <Button size="xs" variant="ghost" onClick={onCopy}>
              <Icon name="copy" size={14} />
              Copy output
            </Button>
          </div>
        </div>
      ) : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

function statusOf(terminal: TerminalInfo): "running" | "ok" | "failed" {
  if (terminal.status === "running") return "running";
  return terminal.exitCode === 0 ? "ok" : "failed";
}

type TabGroup = { name: string; branch: string | null; path: string; terminals: TerminalInfo[] };

/**
 * Tabs grouped by project and worktree (`acme-monorepo / falcon`), in the order each first
 * appears; a folder Studio does not know is its own group, named after the folder.
 */
function groupByWorktree(terminals: readonly TerminalInfo[]): TabGroup[] {
  const groups = new Map<string, TabGroup>();
  for (const terminal of terminals) {
    const name = terminal.project
      ? `${terminal.project}${terminal.worktree ? ` / ${terminal.worktree}` : ""}`
      : lastSegment(terminal.cwd);
    const group = groups.get(name) ?? {
      name,
      branch: terminal.branch ?? null,
      path: terminal.cwd,
      terminals: [],
    };
    group.terminals.push(terminal);
    groups.set(name, group);
  }
  return [...groups.values()];
}

function lastSegment(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}
