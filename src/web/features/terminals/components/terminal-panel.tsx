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
import { groupByWorktree, stateOf, statusText } from "./terminal-groups.ts";
import styles from "./terminal-panel.module.css";
import { TerminalSidebar } from "./terminal-sidebar.tsx";
import { TerminalSwitcher } from "./terminal-switcher.tsx";
import { TerminalTabs } from "./terminal-tabs.tsx";
import { TerminalTitleField } from "./terminal-title-field.tsx";

/** With more terminals than this the panel shows the list instead of header tabs. */
export const COMPACT_MAX = 2;

type TerminalPanelProps = {
  terminals: readonly TerminalInfo[];
  active: TerminalInfo | null;
  dock: TerminalDock;
  /** Whether the right pane is offered: it needs a wide window. */
  canDockRight: boolean;
  /** A narrow screen: the list becomes a dropdown. */
  narrow: boolean;
  size: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  autoScroll: boolean;
  /** The terminal view, or the new-terminal form. */
  children: ReactNode;
  onSelect: (id: string) => void;
  /** An empty title gives back the default one. */
  onRename: (id: string, title: string) => void;
  onCloseTerminal: (id: string) => void;
  onNew: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** Runs every terminal stopped by a Studio restart again. */
  onRunAllAgain: () => void;
  onToggleAutoScroll: () => void;
  onCopy: () => void;
  onToggleDock: () => void;
  onResize: (size: number) => void;
  onResizeSidebar: (width: number) => void;
  onToggleSidebar: () => void;
  onClose: () => void;
};

const RESIZE_STEP = 24;

/**
 * The terminal panel, docked at the bottom or as a pane on the right of the list. One or two
 * terminals show as header tabs; more show as a list grouped by project and worktree, or a
 * dropdown on narrow screens. Then the active terminal's status, controls, ports and screen.
 * Keys while the panel has focus: F2 renames, Ctrl+PageUp and Ctrl+PageDown switch terminals,
 * Ctrl+Shift+W closes the active one.
 */
export function TerminalPanel({
  terminals,
  active,
  dock,
  canDockRight,
  narrow,
  size,
  sidebarWidth,
  sidebarCollapsed,
  autoScroll,
  children,
  onSelect,
  onRename,
  onCloseTerminal,
  onNew,
  onStop,
  onRestart,
  onRunAllAgain,
  onToggleAutoScroll,
  onCopy,
  onToggleDock,
  onResize,
  onResizeSidebar,
  onToggleSidebar,
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

  const listMode = terminals.length > COMPACT_MAX;
  const order = groupByWorktree(terminals).flatMap((group) => group.terminals);
  // These keys work even from inside the terminal screen, which would otherwise get them.
  const panelKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "F2" && active && editingId === null) {
      startEditing(active.id);
    } else if (event.ctrlKey && (event.key === "PageUp" || event.key === "PageDown")) {
      if (order.length < 2) return;
      const index = order.findIndex((terminal) => terminal.id === active?.id);
      const step = event.key === "PageUp" ? -1 : 1;
      const next = order[(index + step + order.length) % order.length];
      if (next) onSelect(next.id);
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "w" && active) {
      onCloseTerminal(active.id);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
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

  const showSidebar = listMode && !narrow && !sidebarCollapsed;
  const showSwitcher = terminals.length > 0 && (narrow || (listMode && sidebarCollapsed));
  const restorable = terminals.filter((terminal) => terminal.stoppedByRestart).length;
  const running = active?.status === "running";
  const dockLabel = dock === "bottom" ? "Terminal on the right" : "Terminal at the bottom";
  return (
    <section
      className={styles.panel}
      data-dock={dock}
      style={{ "--panel-size": `${size}px` } as CSSProperties}
      aria-label="Terminals"
      onKeyDownCapture={panelKeys}
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
        {listMode && !narrow ? (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={sidebarCollapsed ? "Show the terminal list" : "Hide the terminal list"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Show the terminal list" : "Hide the terminal list"}
            onClick={onToggleSidebar}
          >
            <Icon name="sidebar" size={14} />
          </Button>
        ) : null}
        {showSwitcher ? (
          <TerminalSwitcher
            terminals={terminals}
            activeId={active?.id ?? null}
            onSelect={onSelect}
          />
        ) : listMode ? (
          <span className={styles.heading}>
            Terminals <span className={styles.headingCount}>{terminals.length}</span>
          </span>
        ) : (
          <TerminalTabs
            terminals={terminals}
            activeId={active?.id ?? null}
            editingId={editingId}
            onSelect={onSelect}
            onStartEditing={startEditing}
            onFinishEditing={finishEditing}
            onClose={onCloseTerminal}
          />
        )}
        <div className={styles.actions}>
          <Button
            size="xs"
            variant="ghost"
            aria-label="New terminal"
            title="New terminal (Ctrl+`)"
            onClick={onNew}
          >
            <Icon name="plus" size={14} />
            <span className={styles.newLabel}>New terminal</span>
          </Button>
          {canDockRight ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={dockLabel}
              title={dockLabel}
              onClick={onToggleDock}
              className={styles.dockToggle}
            >
              <Icon name="layers" size={14} />
            </Button>
          ) : null}
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
      {restorable > 0 ? (
        <div className={styles.restored} role="status">
          <Icon name="refresh" size={14} />
          <span className={styles.restoredText}>
            {restorable === 1
              ? "1 terminal was stopped by a Studio restart."
              : `${restorable} terminals were stopped by a Studio restart.`}
          </span>
          <Button size="xs" variant="secondary" onClick={onRunAllAgain}>
            {restorable === 1 ? "Run it again" : "Run all again"}
          </Button>
        </div>
      ) : null}
      <div className={styles.main}>
        {showSidebar ? (
          <TerminalSidebar
            terminals={terminals}
            activeId={active?.id ?? null}
            editingId={editingId}
            width={sidebarWidth}
            onSelect={onSelect}
            onStartEditing={startEditing}
            onFinishEditing={finishEditing}
            onClose={onCloseTerminal}
            onResize={onResizeSidebar}
          />
        ) : null}
        <div className={styles.detail}>
          {active ? (
            <div className={styles.toolbar}>
              <span className={styles.status} data-status={stateOf(active)}>
                {statusText(active)}
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
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.portLink}
                        >
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
                <Button
                  size="xs"
                  variant="ghost"
                  aria-pressed={autoScroll}
                  title="Keep the view at the newest output; scrolling up pauses it"
                  onClick={onToggleAutoScroll}
                >
                  <Icon name="arrowDown" size={14} />
                  Auto-scroll
                </Button>
                <Button size="xs" variant="ghost" onClick={onCopy}>
                  <Icon name="copy" size={14} />
                  Copy output
                </Button>
              </div>
            </div>
          ) : null}
          {active && showSwitcher && editingId === active.id ? (
            <div className={styles.renameRow}>
              <TerminalTitleField
                title={active.title}
                onDone={(title) => finishEditing(active.id, title)}
              />
            </div>
          ) : null}
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </section>
  );
}
