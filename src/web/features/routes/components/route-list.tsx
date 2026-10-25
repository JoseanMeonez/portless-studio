import { useId } from "react";
import type { Route } from "../../../../core/routes/route.ts";
import { GroupHeader } from "./group-header.tsx";
import styles from "./route-list.module.css";
import { RouteRow, type RowConfirmation } from "./route-row.tsx";
import type { MenuPoint } from "./row-menu-trigger.ts";

/** A block of rows. An empty label renders its rows without a header. */
export type RouteSection = {
  key: string;
  label: string;
  routes: readonly Route[];
  /** Set for custom groups, which can be renamed and deleted from their header. */
  customGroupId?: string;
};

type RouteListProps = {
  sections: readonly RouteSection[];
  /** Icon per project name, from the snapshot, for group headers. */
  projectIcons?: Readonly<Record<string, string>> | undefined;
  now: number;
  /** Name of the selected route. */
  selectedName: string | null;
  isFavorite: (route: Route) => boolean;
  isCollapsed: (sectionKey: string) => boolean;
  onToggleSection: (sectionKey: string) => void;
  /** The route (by name) whose row asks for a confirmation, and what for. */
  confirming: { name: string; action: RowConfirmation } | null;
  onSelect: (route: Route) => void;
  onOpen: (route: Route) => void;
  onCopy: (route: Route) => void;
  onRename: (route: Route) => void;
  onRequestRemove: (route: Route) => void;
  onRequestStop: (route: Route) => void;
  onConfirm: (route: Route, action: RowConfirmation) => void;
  onCancelConfirm: () => void;
  onToggleFavorite: (route: Route) => void;
  onMoveToGroup: (route: Route) => void;
  onMenu: (route: Route, point: MenuPoint) => void;
  onCopyDirectUrl: (route: Route) => void;
  /** Hidden for routes it returns false for, and entirely without it. */
  onOpenTerminal?: ((route: Route) => void) | undefined;
  canOpenTerminal?: ((route: Route) => boolean) | undefined;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string, name: string) => void;
};

/** The routes, flat or under collapsible group headers, in one list for screen readers. */
export function RouteList(props: RouteListProps) {
  const idPrefix = useId();
  const rows = (routes: readonly Route[]) =>
    routes.map((route) => {
      const action = props.confirming?.name === route.name ? props.confirming.action : null;
      return (
        <RouteRow
          key={route.hostname}
          route={route}
          now={props.now}
          selected={route.name === props.selectedName}
          favorite={props.isFavorite(route)}
          confirming={action}
          onSelect={() => props.onSelect(route)}
          onOpen={() => props.onOpen(route)}
          onCopy={() => props.onCopy(route)}
          onRename={() => props.onRename(route)}
          onRequestRemove={() => props.onRequestRemove(route)}
          onRequestStop={() => props.onRequestStop(route)}
          onConfirm={() => action && props.onConfirm(route, action)}
          onCancelConfirm={props.onCancelConfirm}
          onToggleFavorite={() => props.onToggleFavorite(route)}
          onMoveToGroup={() => props.onMoveToGroup(route)}
          onMenu={(point) => props.onMenu(route, point)}
          onCopyDirectUrl={() => props.onCopyDirectUrl(route)}
          onOpenTerminal={
            props.onOpenTerminal && (props.canOpenTerminal?.(route) ?? true)
              ? () => props.onOpenTerminal?.(route)
              : undefined
          }
        />
      );
    });

  return (
    <ul className={styles.list} aria-label="Routes">
      {props.sections.map((section, index) => {
        if (section.label === "") return rows(section.routes);
        const collapsed = props.isCollapsed(section.key);
        const listId = `${idPrefix}-${index}`;
        const groupId = section.customGroupId;
        return (
          <li key={section.key} role="none" className={styles.group}>
            <GroupHeader
              label={section.label}
              routes={section.routes}
              project={sectionProject(section, props.projectIcons)}
              collapsed={collapsed}
              controls={listId}
              onToggle={() => props.onToggleSection(section.key)}
              {...(groupId
                ? {
                    onRename: () => props.onRenameGroup(groupId, section.label),
                    onDelete: () => props.onDeleteGroup(groupId, section.label),
                  }
                : {})}
            />
            {collapsed ? null : (
              <ul id={listId} className={styles.groupRows} aria-label={section.label}>
                {rows(section.routes)}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The project a group belongs to, when all its routes run from one. */
function sectionProject(
  section: RouteSection,
  icons: Readonly<Record<string, string>> | undefined,
): { name: string; icon: string | undefined } | undefined {
  const names = new Set(section.routes.map((route) => route.project?.name));
  const [name] = names;
  if (names.size !== 1 || !name) return undefined;
  const own = icons && Object.hasOwn(icons, name) ? icons[name] : undefined;
  return { name, icon: own ?? section.routes.find((route) => route.icon)?.icon };
}
