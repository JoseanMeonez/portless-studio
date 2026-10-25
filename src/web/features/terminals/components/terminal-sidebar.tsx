import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import type { Limits } from "../hooks/panel-limits.ts";
import { TerminalCard, type TerminalItemActions } from "./terminal-card.tsx";
import { groupByWorktree, matchesFilter } from "./terminal-groups.ts";
import styles from "./terminal-sidebar.module.css";

/** Past this many terminals the list gets a filter box. */
export const FILTER_FROM = 9;
const RESIZE_STEP = 16;

type TerminalSidebarProps = {
  terminals: readonly TerminalInfo[];
  activeId: string | null;
  editingId: string | null;
  width: number;
  limits: Limits;
  now: number;
  actions: TerminalItemActions;
  /** Enter on a card: show it and put the keyboard in its terminal. */
  onEnter: (id: string) => void;
  onResize: (width: number) => void;
  onResetWidth: () => void;
};

/**
 * The terminal list, grouped by project and worktree: one card per terminal. Arrow keys move
 * between cards, Enter goes into the terminal. Its edge resizes it between `limits`.
 */
export function TerminalSidebar({
  terminals,
  activeId,
  editingId,
  width,
  limits,
  now,
  actions,
  onEnter,
  onResize,
  onResetWidth,
}: TerminalSidebarProps) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const filtering = terminals.length >= FILTER_FROM;
  const shown = filtering ? terminals.filter((item) => matchesFilter(item, query)) : terminals;
  const groups = groupByWorktree(shown);
  const order = groups.flatMap((group) => group.terminals);

  const move = (id: string, step: -1 | 1) => {
    const index = order.findIndex((terminal) => terminal.id === id);
    const next = order[index + step];
    if (!next) return;
    actions.onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[data-terminal="${next.id}"] [role="tab"]`)?.focus();
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = list.current?.getBoundingClientRect().left ?? 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== null) onResize(event.clientX - dragging.current);
  };
  const endDrag = () => {
    dragging.current = null;
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") onResize(width + RESIZE_STEP);
    else if (event.key === "ArrowLeft") onResize(width - RESIZE_STEP);
    else if (event.key === "Home") onResize(limits.min);
    else if (event.key === "End") onResize(limits.max);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={list} className={styles.sidebar} style={{ width }}>
      {filtering ? (
        <div className={styles.filter}>
          <Icon name="search" size={12} />
          <input
            className={styles.filterInput}
            type="search"
            aria-label="Filter terminals"
            placeholder="Filter terminals"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      <div
        className={styles.list}
        role="tablist"
        aria-label="Open terminals"
        aria-orientation="vertical"
      >
        {groups.map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not tabs.
          <div key={group.name} className={styles.group} role="group" aria-label={group.name}>
            {group.terminals.map((terminal) => (
              <TerminalCard
                key={terminal.id}
                terminal={terminal}
                active={terminal.id === activeId}
                editing={editingId === terminal.id}
                now={now}
                actions={actions}
                onMove={move}
                onEnter={onEnter}
              />
            ))}
          </div>
        ))}
        {shown.length === 0 ? <p className={styles.empty}>No terminal matches.</p> : null}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element. */}
      <div
        className={styles.handle}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize the terminal list"
        aria-valuenow={width}
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        title="Drag to resize; double-click to reset"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeWithKeys}
        onDoubleClick={onResetWidth}
      />
    </div>
  );
}
