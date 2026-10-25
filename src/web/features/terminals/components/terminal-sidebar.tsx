import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { groupByWorktree, matchesFilter, shortStatus } from "./terminal-groups.ts";
import styles from "./terminal-sidebar.module.css";
import { TerminalStatusDot } from "./terminal-status-dot.tsx";
import { TerminalTitleField } from "./terminal-title-field.tsx";

/** Past this many terminals the list gets a filter box. */
export const FILTER_FROM = 9;
const RESIZE_STEP = 16;

type TerminalSidebarProps = {
  terminals: readonly TerminalInfo[];
  activeId: string | null;
  editingId: string | null;
  width: number;
  onSelect: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: (id: string, title: string | null) => void;
  onClose: (id: string) => void;
  onResize: (width: number) => void;
};

/**
 * Several terminals: a list grouped by project and worktree with the branch. Each item shows its
 * status, title, command and how many ports it opened; the close button shows on hover.
 */
export function TerminalSidebar({
  terminals,
  activeId,
  editingId,
  width,
  onSelect,
  onStartEditing,
  onFinishEditing,
  onClose,
  onResize,
}: TerminalSidebarProps) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const filtering = terminals.length >= FILTER_FROM;
  const shown = filtering ? terminals.filter((item) => matchesFilter(item, query)) : terminals;

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
        {groupByWorktree(shown).map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not tabs.
          <div key={group.name} className={styles.group} role="group" aria-label={group.name}>
            <div className={styles.groupHeader} title={group.path}>
              <span className={styles.groupName}>{group.name}</span>
              {group.branch ? (
                <span className={styles.branch}>
                  <Icon name="branch" size={11} />
                  {group.branch}
                </span>
              ) : null}
            </div>
            {group.terminals.map((terminal) => {
              const ports = (terminal.ports ?? []).length;
              const active = terminal.id === activeId;
              return (
                <div
                  key={terminal.id}
                  className={styles.item}
                  data-active={active ? "" : undefined}
                >
                  {editingId === terminal.id ? (
                    <TerminalTitleField
                      title={terminal.title}
                      onDone={(title) => onFinishEditing(terminal.id, title)}
                    />
                  ) : (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={terminal.title}
                      aria-description={`${terminal.command || "shell"}, ${shortStatus(terminal)}`}
                      className={styles.itemButton}
                      onClick={() => onSelect(terminal.id)}
                      onDoubleClick={() => onStartEditing(terminal.id)}
                      title={`${terminal.command || "shell"} in ${terminal.cwd}. Double-click or F2 to rename.`}
                    >
                      <span className={styles.titleLine}>
                        <TerminalStatusDot terminal={terminal} />
                        <span className={styles.title}>{terminal.title}</span>
                        {ports > 0 ? (
                          <span className={styles.ports} title={`${ports} open ports`}>
                            <Icon name="globe" size={11} />
                            {ports}
                          </span>
                        ) : null}
                        {terminal.status === "exited" ? (
                          <span className={styles.exit}>{shortStatus(terminal)}</span>
                        ) : null}
                      </span>
                      <span className={styles.command}>{terminal.command || "shell"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.close}
                    aria-label={`Close ${terminal.title}`}
                    title="Close (Ctrl+Shift+W)"
                    onClick={() => onClose(terminal.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              );
            })}
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
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeWithKeys}
      />
    </div>
  );
}
