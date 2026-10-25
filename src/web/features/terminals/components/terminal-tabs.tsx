import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { groupByWorktree } from "./terminal-groups.ts";
import { TerminalStatusDot } from "./terminal-status-dot.tsx";
import styles from "./terminal-tabs.module.css";
import { TerminalTitleField } from "./terminal-title-field.tsx";

type TerminalTabsProps = {
  terminals: readonly TerminalInfo[];
  activeId: string | null;
  editingId: string | null;
  onSelect: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: (id: string, title: string | null) => void;
  onClose: (id: string) => void;
};

/** One or two terminals: compact tabs in the panel header, grouped by project and worktree. */
export function TerminalTabs({
  terminals,
  activeId,
  editingId,
  onSelect,
  onStartEditing,
  onFinishEditing,
  onClose,
}: TerminalTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Open terminals">
      {groupByWorktree(terminals).map((group) => (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, not tabs.
        <div key={group.name} className={styles.group} role="group" aria-label={group.name}>
          <span className={styles.groupName} title={group.path}>
            {group.name}
            {group.branch ? <span className={styles.branch}>{group.branch}</span> : null}
          </span>
          {group.terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={styles.tab}
              data-active={terminal.id === activeId ? "" : undefined}
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
                  aria-selected={terminal.id === activeId}
                  className={styles.tabButton}
                  onClick={() => onSelect(terminal.id)}
                  onDoubleClick={() => onStartEditing(terminal.id)}
                  title={`${terminal.command || "shell"} in ${terminal.cwd}. Double-click or F2 to rename.`}
                >
                  <TerminalStatusDot terminal={terminal} />
                  <span className={styles.title}>{terminal.title}</span>
                </button>
              )}
              <button
                type="button"
                className={styles.close}
                aria-label={`Close ${terminal.title}`}
                onClick={() => onClose(terminal.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
