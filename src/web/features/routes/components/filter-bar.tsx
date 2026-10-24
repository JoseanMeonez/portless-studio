import type { ReactNode, Ref } from "react";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import styles from "./filter-bar.module.css";

type FilterBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  visibleCount: number;
  totalCount: number;
  /** True when view filters, not only the search, narrow the list. */
  narrowed?: boolean;
  inputRef: Ref<HTMLInputElement>;
  /** Shown before the search field: the view switcher. */
  leading?: ReactNode;
};

export function FilterBar({
  query,
  onQueryChange,
  visibleCount,
  totalCount,
  narrowed = false,
  inputRef,
  leading,
}: FilterBarProps) {
  const searching = query.trim() !== "" || narrowed;
  // With no routes yet the filter only narrows detected ports, which count themselves.
  const count =
    totalCount === 0
      ? ""
      : searching
        ? `${visibleCount} of ${totalCount}`
        : `${totalCount} ${totalCount === 1 ? "route" : "routes"}`;

  return (
    <div className={styles.bar}>
      {leading}
      <div className={styles.search}>
        <Icon name="search" className={styles.searchIcon} />
        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          placeholder="Filter routes"
          aria-label="Filter routes"
          value={query}
          spellCheck={false}
          autoComplete="off"
          data-list-keys=""
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              if (query) onQueryChange("");
              else event.currentTarget.blur();
            }
          }}
        />
        {query === "" ? <Kbd className={styles.hint}>/</Kbd> : null}
      </div>
      <output className={styles.count} aria-live="polite">
        {count}
      </output>
    </div>
  );
}
