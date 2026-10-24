import type { Ref } from "react";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import type { SortOrder } from "../hooks/use-filter.ts";
import styles from "./filter-bar.module.css";

type FilterBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  visibleCount: number;
  totalCount: number;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  inputRef: Ref<HTMLInputElement>;
};

export function FilterBar({
  query,
  onQueryChange,
  visibleCount,
  totalCount,
  sort,
  onSortChange,
  inputRef,
}: FilterBarProps) {
  const count =
    query.trim() === ""
      ? `${totalCount} ${totalCount === 1 ? "route" : "routes"}`
      : `${visibleCount} of ${totalCount}`;

  return (
    <div className={styles.bar}>
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSortChange(sort === "name" ? "newest" : "name")}
        aria-label={`Sort by ${sort === "name" ? "newest" : "name"}`}
        title="Change sort order"
      >
        <Icon name="sortDown" size={14} />
        {sort === "name" ? "Name" : "Newest"}
      </Button>
    </div>
  );
}
