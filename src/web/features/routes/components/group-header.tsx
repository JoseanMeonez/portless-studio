import type { Route } from "../../../../core/routes/route.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import styles from "./group-header.module.css";

type GroupHeaderProps = {
  label: string;
  routes: readonly Route[];
  /** Set when every route in the group belongs to one project. */
  project?: { name: string; icon: string | undefined } | undefined;
  collapsed: boolean;
  /** Id of the list the header opens and closes. */
  controls: string;
  onToggle: () => void;
  /** Only custom groups can be renamed and deleted. */
  onRename?: () => void;
  onDelete?: () => void;
};

/** A group's name, how many routes it holds and how many answer, errors or are down. */
export function GroupHeader({
  label,
  routes,
  project,
  collapsed,
  controls,
  onToggle,
  onRename,
  onDelete,
}: GroupHeaderProps) {
  const count = (state: string) => routes.filter((route) => route.health?.state === state).length;
  const up = count("up");
  const errors = count("error");
  // A silent alias (a database) is not a problem, so only apps count as down.
  const down = routes.filter((route) => route.kind === "app" && route.health?.state === "down");
  const summary = [
    up > 0 ? `${up} up` : "",
    errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
    down.length > 0 ? `${down.length} down` : "",
  ].filter(Boolean);

  return (
    <div className={styles.header}>
      <h3 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : controls}
          aria-label={`${label}, ${routes.length} ${routes.length === 1 ? "route" : "routes"}`}
          onClick={onToggle}
        >
          <Icon
            name="chevronDown"
            size={14}
            className={collapsed ? `${styles.chevron} ${styles.closed}` : styles.chevron}
          />
          {project ? <ItemIcon icon={project.icon} name={project.name} size="sm" /> : null}
          <span className={styles.label}>{label}</span>
          <span className={styles.count}>{routes.length}</span>
        </button>
      </h3>
      {summary.length > 0 ? (
        <span className={styles.summary}>
          <StatusDot tone={down.length > 0 ? "danger" : errors > 0 ? "warning" : "success"} />
          <span className={styles.summaryText}>{summary.join(", ")}</span>
        </span>
      ) : null}
      {onRename || onDelete ? (
        <span className={styles.actions}>
          {onRename ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Rename group ${label}`}
              title="Rename group"
              onClick={onRename}
            >
              <Icon name="pencil" size={14} />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Delete group ${label}`}
              title="Delete group (its routes stay)"
              onClick={onDelete}
            >
              <Icon name="trash" size={14} />
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
