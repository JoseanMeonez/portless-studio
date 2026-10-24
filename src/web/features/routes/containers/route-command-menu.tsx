import type { Route } from "../../../../core/routes/route.ts";
import { type CommandItem, CommandMenu } from "../../../shared/ui/command-menu.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import { useRouteActions } from "../hooks/use-route-actions.ts";

type RouteCommandMenuProps = {
  routes: readonly Route[];
  selected: Route | null;
  onClose: () => void;
  onNamePort: () => void;
  onRename: (route: Route) => void;
  onToggleTheme: () => void;
  onFocusFilter: () => void;
};

/** Cmd/Ctrl+K: jump to any route or run any action without leaving the keyboard. */
export function RouteCommandMenu({
  routes,
  selected,
  onClose,
  onNamePort,
  onRename,
  onToggleTheme,
  onFocusFilter,
}: RouteCommandMenuProps) {
  const actions = useRouteActions();

  const items: CommandItem[] = [
    ...routes.map(
      (route): CommandItem => ({
        id: `route-${route.hostname}`,
        group: "Routes",
        label: route.name,
        detail: route.url,
        icon: "arrowUpRight",
        onSelect: () => actions.open(route),
      }),
    ),
    {
      id: "name-port",
      group: "Actions",
      label: "Name a port",
      icon: "plus",
      shortcut: <Kbd>N</Kbd>,
      onSelect: onNamePort,
    },
    ...(selected
      ? [
          {
            id: "copy-selected",
            group: "Actions",
            label: `Copy URL of ${selected.name}`,
            icon: "copy",
            shortcut: <Kbd>C</Kbd>,
            onSelect: () => void actions.copyUrl(selected),
          } satisfies CommandItem,
        ]
      : []),
    ...(selected?.kind === "alias"
      ? [
          {
            id: "rename-selected",
            group: "Actions",
            label: `Rename ${selected.name}`,
            icon: "pencil",
            shortcut: <Kbd>R</Kbd>,
            onSelect: () => onRename(selected),
          } satisfies CommandItem,
        ]
      : []),
    {
      id: "filter",
      group: "Actions",
      label: "Filter routes",
      icon: "search",
      shortcut: <Kbd>/</Kbd>,
      onSelect: onFocusFilter,
    },
    { id: "theme", group: "Actions", label: "Toggle theme", icon: "moon", onSelect: onToggleTheme },
  ];

  return <CommandMenu items={items} onClose={onClose} placeholder="Search routes and actions" />;
}
