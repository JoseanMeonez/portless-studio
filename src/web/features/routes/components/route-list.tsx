import type { Route } from "../../../../core/routes/route.ts";
import styles from "./route-list.module.css";
import { RouteRow, type RowConfirmation } from "./route-row.tsx";

type RouteListProps = {
  routes: readonly Route[];
  now: number;
  selectedIndex: number;
  /** The route (by name) whose row asks for a confirmation, and what for. */
  confirming: { name: string; action: RowConfirmation } | null;
  onSelect: (index: number) => void;
  onOpen: (route: Route) => void;
  onCopy: (route: Route) => void;
  onRename: (route: Route) => void;
  onRequestRemove: (route: Route) => void;
  onRequestStop: (route: Route) => void;
  onConfirm: (route: Route, action: RowConfirmation) => void;
  onCancelConfirm: () => void;
};

export function RouteList({
  routes,
  now,
  selectedIndex,
  confirming,
  onSelect,
  onOpen,
  onCopy,
  onRename,
  onRequestRemove,
  onRequestStop,
  onConfirm,
  onCancelConfirm,
}: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route, index) => {
        const action = confirming?.name === route.name ? confirming.action : null;
        return (
          <RouteRow
            key={route.hostname}
            route={route}
            now={now}
            selected={index === selectedIndex}
            confirming={action}
            onSelect={() => onSelect(index)}
            onOpen={() => onOpen(route)}
            onCopy={() => onCopy(route)}
            onRename={() => onRename(route)}
            onRequestRemove={() => onRequestRemove(route)}
            onRequestStop={() => onRequestStop(route)}
            onConfirm={() => action && onConfirm(route, action)}
            onCancelConfirm={onCancelConfirm}
          />
        );
      })}
    </ul>
  );
}
