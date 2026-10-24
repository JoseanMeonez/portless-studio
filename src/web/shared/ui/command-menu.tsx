import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { fuzzyFilter } from "../lib/fuzzy-match.ts";
import styles from "./command-menu.module.css";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/icon-paths.ts";
import { Kbd } from "./kbd.tsx";
import { useFocusTrap } from "./use-focus-trap.ts";

export type CommandItem = {
  id: string;
  group: string;
  label: string;
  /** Secondary text on the right, such as a URL. Also searched. */
  detail?: string;
  icon?: IconName;
  shortcut?: ReactNode;
  onSelect: () => void;
};

type CommandMenuProps = {
  items: readonly CommandItem[];
  onClose: () => void;
  placeholder?: string;
};

/** Search-as-you-type list of commands. Mount it to open it; picking a command closes it. */
export function CommandMenu({
  items,
  onClose,
  placeholder = "Type a command or search",
}: CommandMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  useFocusTrap(panel, onClose);

  const matches = useMemo(
    () => fuzzyFilter(items, query, (item) => `${item.label} ${item.detail ?? ""}`),
    [items, query],
  );
  const active = matches[Math.min(activeIndex, matches.length - 1)];
  const optionId = (item: CommandItem) => `${listId}-${item.id}`;

  useEffect(() => {
    if (!active) return;
    document.getElementById(`${listId}-${active.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const choose = (item: CommandItem) => {
    onClose();
    item.onSelect();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      choose(active);
    }
  };

  // Group headings follow the order in which groups first appear among the matches.
  const groups = [...new Set(matches.map((item) => item.group))];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside closes; Esc is the keyboard way.
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className={styles.panel}
      >
        <div className={styles.search}>
          <Icon name="search" className={styles.searchIcon} />
          <input
            // biome-ignore lint/a11y/noAutofocus: the menu exists to be typed into right away.
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
            className={styles.input}
            placeholder={placeholder}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className={styles.list}>
          {matches.length === 0 ? <p className={styles.empty}>No results for “{query}”</p> : null}
          {groups.map((group) => (
            <div key={group}>
              <div className={styles.groupLabel} aria-hidden="true">
                {group}
              </div>
              {matches
                .filter((item) => item.group === group)
                .map((item) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the search field moves through options with the keyboard.
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={item === active}
                    tabIndex={-1}
                    className={styles.option}
                    onMouseMove={() => setActiveIndex(matches.indexOf(item))}
                    onClick={() => choose(item)}
                  >
                    {item.icon ? <Icon name={item.icon} className={styles.optionIcon} /> : null}
                    <span className={styles.optionLabel}>{item.label}</span>
                    {item.detail ? (
                      <span className={styles.optionDetail}>{item.detail}</span>
                    ) : null}
                    {item.shortcut ? (
                      <span className={styles.optionShortcut}>{item.shortcut}</span>
                    ) : null}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
