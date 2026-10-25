import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { RouteHealthState } from "../../../../core/routes/route.ts";
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  type ItemKind,
  type ViewFilters,
} from "../../../../core/views/view.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import styles from "./filter-menu.module.css";

export const KIND_LABELS: Record<ItemKind, string> = {
  app: "Apps",
  alias: "Aliases",
  detected: "Detected",
};

const STATUS_LABELS: Record<RouteHealthState, string> = { up: "Up", error: "Error", down: "Down" };

/** Past this many projects the Project section gets its own search field. */
const PROJECT_SEARCH_MIN = 7;

const NO_FILTERS: ViewFilters = { kinds: [], projects: [], statuses: [] };

/** How many kinds, statuses and projects the view filters on. */
export function activeFilterCount(filters: ViewFilters): number {
  return filters.kinds.length + filters.statuses.length + filters.projects.length;
}

type FilterMenuProps = {
  filters: ViewFilters;
  /** Every project name the routes and detected ports belong to. */
  projects: readonly string[];
  /** Icon per project name, shown next to each project option. */
  projectIcons?: Readonly<Record<string, string>> | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFiltersChange: (filters: ViewFilters) => void;
};

/**
 * The Filter button and its popover. Project names stay inside the popover so the toolbar
 * shows only how many filters are on, never which projects.
 */
export function FilterMenu({
  filters,
  projects,
  projectIcons,
  open,
  onOpenChange,
  onFiltersChange,
}: FilterMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [projectQuery, setProjectQuery] = useState("");
  const count = activeFilterCount(filters);

  useEffect(() => {
    if (!open) {
      setProjectQuery("");
      return;
    }
    root.current
      ?.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onOpenChange(false);
        trigger.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      // Arrow keys move between the options and the project search, as in a menu.
      const options = [
        ...(root.current?.querySelectorAll<HTMLInputElement>('[role="dialog"] input') ?? []),
      ];
      const at = options.indexOf(document.activeElement as HTMLInputElement);
      if (at === -1) return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === "ArrowDown" ? at + 1 : at - 1;
      options[(next + options.length) % options.length]?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  const toggle = <K extends keyof ViewFilters>(field: K, value: ViewFilters[K][number]) => {
    const current = filters[field] as string[];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [field]: next });
  };

  const query = projectQuery.trim().toLowerCase();
  const shownProjects = query
    ? projects.filter((project) => project.toLowerCase().includes(query))
    : projects;

  return (
    <>
      <div className={styles.root} ref={root}>
        <button
          ref={trigger}
          type="button"
          className={styles.trigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
          title="Filters (Shift+F)"
          onClick={() => onOpenChange(!open)}
        >
          <Icon name="filter" size={14} className={styles.triggerIcon} />
          <span>Filter</span>
          {count > 0 ? (
            <span className={styles.badge} aria-hidden="true" data-filter-count="">
              {count}
            </span>
          ) : null}
        </button>
        {open ? (
          <div id={panelId} role="dialog" aria-label="Filters" className={styles.panel}>
            <Section title="Kind">
              {ITEM_KINDS.map((kind) => (
                <Option
                  key={kind}
                  label={KIND_LABELS[kind]}
                  checked={filters.kinds.includes(kind)}
                  onChange={() => toggle("kinds", kind)}
                />
              ))}
            </Section>
            <Section title="Status">
              {ITEM_STATUSES.map((status) => (
                <Option
                  key={status}
                  label={STATUS_LABELS[status]}
                  checked={filters.statuses.includes(status)}
                  onChange={() => toggle("statuses", status)}
                />
              ))}
            </Section>
            {projects.length > 0 ? (
              <Section title="Project">
                {projects.length >= PROJECT_SEARCH_MIN ? (
                  <input
                    type="search"
                    className={styles.search}
                    placeholder="Find a project"
                    aria-label="Find a project"
                    value={projectQuery}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setProjectQuery(event.target.value)}
                  />
                ) : null}
                <div className={styles.projects}>
                  {shownProjects.map((project) => (
                    <Option
                      key={project}
                      label={project}
                      icon={<ItemIcon icon={projectIcons?.[project]} name={project} size="sm" />}
                      checked={filters.projects.includes(project)}
                      onChange={() => toggle("projects", project)}
                    />
                  ))}
                  {shownProjects.length === 0 ? (
                    <p className={styles.empty}>No projects match.</p>
                  ) : null}
                </div>
              </Section>
            ) : null}
            <div className={styles.footer}>
              <Button
                size="sm"
                variant="ghost"
                disabled={count === 0}
                onClick={() => onFiltersChange(NO_FILTERS)}
              >
                Clear all
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {count > 0 ? (
        <span className={styles.summary}>
          <span>{count === 1 ? "1 filter" : `${count} filters`}</span>
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear all filters"
            title="Clear all filters"
            onClick={() => onFiltersChange(NO_FILTERS)}
          >
            <Icon name="x" size={12} />
          </button>
        </span>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.section}>
      <legend className={styles.legend}>{title}</legend>
      {children}
    </fieldset>
  );
}

function Option({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={styles.option} title={label}>
      <input type="checkbox" className={styles.checkbox} checked={checked} onChange={onChange} />
      {icon}
      <span className={styles.optionLabel}>{label}</span>
    </label>
  );
}
