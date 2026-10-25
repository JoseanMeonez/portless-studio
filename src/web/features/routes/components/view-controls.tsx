import {
  GROUP_BY_OPTIONS,
  SORT_BY_OPTIONS,
  type View,
  type ViewFilters,
  type ViewGroupBy,
  type ViewSort,
} from "../../../../core/views/view.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { FilterMenu } from "./filter-menu.tsx";
import styles from "./view-controls.module.css";

type ViewControlsProps = {
  /** The view as shown, with any unsaved changes. */
  view: View;
  /** Every project name the routes and detected ports belong to. */
  projects: readonly string[];
  /** Icon per project name, shown in the filter popover. */
  projectIcons?: Readonly<Record<string, string>> | undefined;
  /** Whether the filter popover is open; the dashboard owns it so Shift+F can open it. */
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  onGroupByChange: (groupBy: ViewGroupBy) => void;
  onSortChange: (sort: ViewSort) => void;
  onFiltersChange: (filters: ViewFilters) => void;
  /** Shown only when the list is grouped. */
  onCollapseAll?: (() => void) | undefined;
  onExpandAll?: (() => void) | undefined;
};

export const GROUP_LABELS: Record<ViewGroupBy, string> = {
  none: "No grouping",
  project: "Project",
  worktree: "Worktree",
  kind: "Kind",
  status: "Status",
  custom: "Custom groups",
};

const SORT_LABELS: Record<ViewSort["by"], string> = {
  name: "Name",
  port: "Port",
  newest: "Newest",
  status: "Status",
};

/** Grouping, sort and the Filter button of the current view; changes stay in the URL until saved. */
export function ViewControls({
  view,
  projects,
  projectIcons,
  filtersOpen,
  onFiltersOpenChange,
  onGroupByChange,
  onSortChange,
  onFiltersChange,
  onCollapseAll,
  onExpandAll,
}: ViewControlsProps) {
  const { sort } = view;

  return (
    <div className={styles.controls}>
      <label className={styles.select}>
        <span className={styles.selectLabel}>Group</span>
        <select
          value={view.groupBy}
          aria-label="Group by"
          onChange={(event) => onGroupByChange(event.target.value as ViewGroupBy)}
        >
          {GROUP_BY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {GROUP_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.select}>
        <span className={styles.selectLabel}>Sort</span>
        <select
          value={sort.by}
          aria-label="Sort by"
          onChange={(event) => onSortChange({ ...sort, by: event.target.value as ViewSort["by"] })}
        >
          {SORT_BY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label={sort.direction === "asc" ? "Reverse the order" : "Restore the order"}
        aria-pressed={sort.direction === "desc"}
        title={sort.direction === "asc" ? "Ascending" : "Descending"}
        onClick={() =>
          onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })
        }
      >
        <Icon
          name="sortDown"
          size={14}
          className={sort.direction === "desc" ? styles.flipped : undefined}
        />
      </Button>
      {view.groupBy !== "none" && onCollapseAll && onExpandAll ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="Collapse all groups"
            title="Collapse all groups ( [ )"
            onClick={onCollapseAll}
          >
            <Icon name="chevronRight" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="Expand all groups"
            title="Expand all groups ( ] )"
            onClick={onExpandAll}
          >
            <Icon name="chevronDown" size={14} />
          </Button>
        </>
      ) : null}

      <span className={styles.divider} aria-hidden="true" />

      <FilterMenu
        filters={view.filters}
        projects={projects}
        projectIcons={projectIcons}
        open={filtersOpen}
        onOpenChange={onFiltersOpenChange}
        onFiltersChange={onFiltersChange}
      />
    </div>
  );
}
