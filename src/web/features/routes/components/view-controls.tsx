import type { ReactNode } from "react";
import type { RouteHealthState } from "../../../../core/routes/route.ts";
import {
  GROUP_BY_OPTIONS,
  hasFilters,
  ITEM_KINDS,
  ITEM_STATUSES,
  type ItemKind,
  SORT_BY_OPTIONS,
  type View,
  type ViewFilters,
  type ViewGroupBy,
  type ViewSort,
} from "../../../../core/views/view.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./view-controls.module.css";

type ViewControlsProps = {
  /** The view as shown, with any unsaved changes. */
  view: View;
  /** Every project name the routes and detected ports belong to. */
  projects: readonly string[];
  onGroupByChange: (groupBy: ViewGroupBy) => void;
  onSortChange: (sort: ViewSort) => void;
  onFiltersChange: (filters: ViewFilters) => void;
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

export const KIND_LABELS: Record<ItemKind, string> = {
  app: "Apps",
  alias: "Aliases",
  detected: "Detected",
};

const STATUS_LABELS: Record<RouteHealthState, string> = { up: "Up", error: "Error", down: "Down" };

/** Grouping, sort and filter chips of the current view; changes stay in the URL until saved. */
export function ViewControls({
  view,
  projects,
  onGroupByChange,
  onSortChange,
  onFiltersChange,
}: ViewControlsProps) {
  const { filters, sort } = view;
  const toggle = <K extends keyof ViewFilters>(field: K, value: ViewFilters[K][number]) => {
    const current = filters[field] as string[];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [field]: next });
  };

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

      <span className={styles.divider} aria-hidden="true" />

      <ChipGroup label="Filter by kind">
        {ITEM_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={KIND_LABELS[kind]}
            pressed={filters.kinds.includes(kind)}
            onClick={() => toggle("kinds", kind)}
          />
        ))}
      </ChipGroup>
      <ChipGroup label="Filter by status">
        {ITEM_STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={STATUS_LABELS[status]}
            pressed={filters.statuses.includes(status)}
            onClick={() => toggle("statuses", status)}
          />
        ))}
      </ChipGroup>
      {projects.length > 0 ? (
        <ChipGroup label="Filter by project">
          {projects.map((project) => (
            <FilterChip
              key={project}
              label={project}
              pressed={filters.projects.includes(project)}
              onClick={() => toggle("projects", project)}
            />
          ))}
        </ChipGroup>
      ) : null}
      {hasFilters(filters) ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFiltersChange({ kinds: [], projects: [], statuses: [] })}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend for a row of toggle buttons.
    <div role="group" aria-label={label} className={styles.chips}>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {pressed ? <Icon name="check" size={12} /> : null}
      <span className={styles.chipLabel}>{label}</span>
    </button>
  );
}
