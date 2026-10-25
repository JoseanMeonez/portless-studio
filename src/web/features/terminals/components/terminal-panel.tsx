import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { panelKey } from "../hooks/panel-keys.ts";
import type { Limits } from "../hooks/panel-limits.ts";
import type { TerminalDock } from "../hooks/use-terminal-panel.ts";
import type { TerminalItemActions } from "./terminal-card.tsx";
import { groupByWorktree } from "./terminal-groups.ts";
import { TerminalHeader } from "./terminal-header.tsx";
import styles from "./terminal-panel.module.css";
import { TerminalSidebar } from "./terminal-sidebar.tsx";
import { TerminalSwitcher } from "./terminal-switcher.tsx";

type TerminalPanelProps = {
  terminals: readonly TerminalInfo[];
  active: TerminalInfo | null;
  dock: TerminalDock;
  /** Whether the right pane is offered: it needs a wide window. */
  canDockRight: boolean;
  /** The panel covers the whole window. */
  fullScreen: boolean;
  /** A narrow screen: always full screen, and the list is a dropdown. */
  narrow: boolean;
  size: number;
  sizeLimits: Limits;
  sidebarWidth: number;
  sidebarLimits: Limits;
  sidebarCollapsed: boolean;
  /** Whether the list fits beside the terminal; when not, a dropdown takes its place. */
  sidebarFits: boolean;
  autoScroll: boolean;
  now: number;
  /** The terminal view, or the new-terminal form. */
  children: ReactNode;
  actions: Omit<TerminalItemActions, "onStartEditing" | "onFinishEditing"> & {
    /** An empty title gives back the default one. */
    onRename: (id: string, title: string) => void;
  };
  /** Enter on a card: show it and put the keyboard in its terminal. */
  onEnterTerminal: (id: string) => void;
  onNew: () => void;
  /** Runs every terminal stopped by a Studio restart again. */
  onRunAllAgain: () => void;
  onToggleAutoScroll: () => void;
  onCopyOutput: () => void;
  onToggleDock: () => void;
  onToggleFullScreen: () => void;
  onResize: (size: number) => void;
  onResetSize: () => void;
  onResizeSidebar: (width: number) => void;
  onResetSidebarWidth: () => void;
  onToggleSidebar: () => void;
  onClose: () => void;
};

const RESIZE_STEP = 24;

/**
 * The terminal panel, docked at the bottom, as a pane on the right of the list, or full screen.
 * A list of terminal cards grouped by project and worktree sits on the left (a dropdown when it
 * is hidden or does not fit), the active terminal's header and screen on the right.
 * Keys while the panel has focus: F2 renames, Ctrl+PageUp and Ctrl+PageDown switch terminals,
 * Ctrl+Shift+W closes the active one, Ctrl+B (Cmd+B) hides or shows the list, Ctrl+Shift+F
 * toggles full screen and Esc outside the terminal screen leaves it.
 */
export function TerminalPanel({
  terminals,
  active,
  dock,
  canDockRight,
  fullScreen,
  narrow,
  size,
  sizeLimits,
  sidebarWidth,
  sidebarLimits,
  sidebarCollapsed,
  sidebarFits,
  autoScroll,
  now,
  children,
  actions,
  onEnterTerminal,
  onNew,
  onRunAllAgain,
  onToggleAutoScroll,
  onCopyOutput,
  onToggleDock,
  onToggleFullScreen,
  onResize,
  onResetSize,
  onResizeSidebar,
  onResetSidebarWidth,
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
    if (title !== null) actions.onRename(id, title);
    setEditingId(null);
  };
  const itemActions: TerminalItemActions = {
    ...actions,
    onStartEditing: startEditing,
    onFinishEditing: finishEditing,
  };

  const order = groupByWorktree(terminals).flatMap((group) => group.terminals);
  // These keys work even from inside the terminal screen, which would otherwise get them.
  const panelKeys = (event: KeyboardEvent<HTMLElement>) => {
    const key = panelKey(event.nativeEvent);
    if (key === null) {
      if (event.key !== "Escape" || !fullScreen || narrow || editingId !== null) return;
      // Escape belongs to the program in the terminal and to open fields; elsewhere it leaves.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-terminal-screen], input, select")
      ) {
        return;
      }
      onToggleFullScreen();
    } else if (key === "rename") {
      if (!active || editingId !== null) return;
      startEditing(active.id);
    } else if (key === "next" || key === "previous") {
      if (order.length < 2) return;
      const index = order.findIndex((terminal) => terminal.id === active?.id);
      const step = key === "previous" ? -1 : 1;
      const next = order[(index + step + order.length) % order.length];
      if (next) actions.onSelect(next.id);
    } else if (key === "close") {
      if (!active) return;
      actions.onClose(active.id);
    } else if (key === "toggle-list") {
      onToggleSidebar();
    } else if (key === "full-screen") {
      if (narrow) return;
      onToggleFullScreen();
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
    else if (event.key === "Home") onResize(sizeLimits.min);
    else if (event.key === "End") onResize(sizeLimits.max);
    else return;
    event.preventDefault();
  };

  const hasTerminals = terminals.length > 0;
  const showSidebar = hasTerminals && sidebarFits && !sidebarCollapsed;
  const showSwitcher = hasTerminals && !showSidebar;
  const restorable = terminals.filter((terminal) => terminal.stoppedByRestart).length;
  const dockLabel = dock === "bottom" ? "Terminal on the right" : "Terminal at the bottom";
  const listLabel = sidebarCollapsed ? "Show the terminal list" : "Hide the terminal list";
  return (
    <section
      className={styles.panel}
      data-dock={dock}
      data-full-screen={fullScreen ? "" : undefined}
      style={{ "--panel-size": `${size}px` } as CSSProperties}
      aria-label="Terminals"
      onKeyDownCapture={panelKeys}
    >
      {fullScreen ? null : (
        // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element.
        <div
          className={styles.handle}
          role="separator"
          tabIndex={0}
          aria-orientation={dock === "bottom" ? "horizontal" : "vertical"}
          aria-label="Resize the terminal panel"
          aria-valuenow={size}
          aria-valuemin={sizeLimits.min}
          aria-valuemax={sizeLimits.max}
          title="Drag to resize; double-click to reset"
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={resizeWithKeys}
          onDoubleClick={onResetSize}
        />
      )}
      <header className={styles.header}>
        {hasTerminals && sidebarFits ? (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={listLabel}
            aria-expanded={!sidebarCollapsed}
            title={`${listLabel} (Ctrl+B)`}
            onClick={onToggleSidebar}
          >
            <Icon name="sidebar" size={14} />
          </Button>
        ) : null}
        {showSwitcher ? (
          <TerminalSwitcher
            terminals={terminals}
            activeId={active?.id ?? null}
            onSelect={actions.onSelect}
          />
        ) : (
          <span className={styles.heading}>
            Terminals <span className={styles.headingCount}>{terminals.length}</span>
          </span>
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
          {canDockRight && !fullScreen ? (
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
            <Icon
              name={fullScreen ? "x" : dock === "right" ? "chevronRight" : "chevronDown"}
              size={14}
            />
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
            limits={sidebarLimits}
            now={now}
            actions={itemActions}
            onEnter={onEnterTerminal}
            onResize={onResizeSidebar}
            onResetWidth={onResetSidebarWidth}
          />
        ) : null}
        <div className={styles.detail}>
          {active ? (
            <TerminalHeader
              terminal={active}
              editing={!showSidebar && editingId === active.id}
              fullScreen={fullScreen}
              canLeaveFullScreen={!narrow}
              autoScroll={autoScroll}
              actions={itemActions}
              onCopyOutput={onCopyOutput}
              onToggleAutoScroll={onToggleAutoScroll}
              onToggleFullScreen={onToggleFullScreen}
            />
          ) : null}
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </section>
  );
}
