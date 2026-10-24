import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from "react";
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
 * The docked terminal panel: tabs grouped by project, the active terminal's status and controls,
 * and its screen. A handle on its inner edge resizes it; below 640 px it covers the page.
 */
export function TerminalPanel({
  terminals,
  active,
  dock,
  size,
  follow,
  children,
  onSelect,
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
          {groupByProject(terminals).map((group) => (
            <div key={group.name} className={styles.group}>
              <span className={styles.groupName}>{group.name}</span>
              {group.terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className={styles.tab}
                  data-active={terminal.id === active?.id ? "" : undefined}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={terminal.id === active?.id}
                    className={styles.tabButton}
                    onClick={() => onSelect(terminal.id)}
                    title={`${terminal.command || "shell"} in ${terminal.cwd}`}
                  >
                    <span
                      className={styles.dot}
                      data-status={statusOf(terminal)}
                      aria-hidden="true"
                    />
                    <span className={styles.tabTitle}>{terminal.title}</span>
                  </button>
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
          <div className={styles.toolbarActions}>
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

/** Tabs grouped by project, in the order each project first appears. */
function groupByProject(terminals: readonly TerminalInfo[]) {
  const groups = new Map<string, TerminalInfo[]>();
  for (const terminal of terminals) {
    const name = terminal.project ?? lastSegment(terminal.cwd);
    groups.set(name, [...(groups.get(name) ?? []), terminal]);
  }
  return [...groups].map(([name, items]) => ({ name, terminals: items }));
}

function lastSegment(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}
