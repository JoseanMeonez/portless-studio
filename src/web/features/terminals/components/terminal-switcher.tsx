import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { groupByWorktree, shortStatus } from "./terminal-groups.ts";
import styles from "./terminal-switcher.module.css";

type TerminalSwitcherProps = {
  terminals: readonly TerminalInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

/** The terminal list as one dropdown, for narrow screens and a collapsed list. */
export function TerminalSwitcher({ terminals, activeId, onSelect }: TerminalSwitcherProps) {
  return (
    <select
      className={styles.select}
      aria-label="Terminal"
      value={activeId ?? ""}
      onChange={(event) => onSelect(event.target.value)}
    >
      {groupByWorktree(terminals).map((group) => (
        <optgroup
          key={group.name}
          label={group.branch ? `${group.name} (${group.branch})` : group.name}
        >
          {group.terminals.map((terminal) => (
            <option key={terminal.id} value={terminal.id}>
              {terminal.title} · {shortStatus(terminal)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
