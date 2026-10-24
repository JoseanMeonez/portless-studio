import type { Route } from "../../../../core/routes/route.ts";
import styles from "./route-list.module.css";
import { RouteRow } from "./route-row.tsx";

type RouteListProps = {
  routes: readonly Route[];
  now: number;
  selectedIndex: number;
  confirmingRemove: string | null;
  onSelect: (index: number) => void;
  onOpen: (route: Route) => void;
  onCopy: (route: Route) => void;
  onRename: (route: Route) => void;
  onRequestRemove: (route: Route) => void;
  onConfirmRemove: (route: Route) => void;
  onCancelRemove: () => void;
};

export function RouteList({
  routes,
  now,
  selectedIndex,
  confirmingRemove,
  onSelect,
  onOpen,
  onCopy,
  onRename,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: RouteListProps) {
  return (
    <ul className={styles.list} aria-label="Routes">
      {routes.map((route, index) => (
        <RouteRow
          key={route.hostname}
          route={route}
          now={now}
          selected={index === selectedIndex}
          confirmingRemove={confirmingRemove === route.name}
          onSelect={() => onSelect(index)}
          onOpen={() => onOpen(route)}
          onCopy={() => onCopy(route)}
          onRename={() => onRename(route)}
          onRequestRemove={() => onRequestRemove(route)}
          onConfirmRemove={() => onConfirmRemove(route)}
          onCancelRemove={onCancelRemove}
        />
      ))}
    </ul>
  );
}
