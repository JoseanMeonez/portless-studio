import type { ProxyAction } from "../../../../core/api/contract.ts";
import type { Route } from "../../../../core/routes/route.ts";
import { ITEM_KINDS, type ItemKind, type View } from "../../../../core/views/view.ts";
import { modifierLabel } from "../../../shared/lib/keyboard.ts";
import { type CommandItem, CommandMenu } from "../../../shared/ui/command-menu.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import { KIND_LABELS } from "../components/view-controls.tsx";
import { type ShortcutId, shortcutKeys } from "../hooks/shortcut-registry.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";

type RouteCommandMenuProps = {
  routes: readonly Route[];
  selected: Route | null;
  /** Whether the selected route is pinned, to word the toggle. */
  selectedIsFavorite: boolean;
  views: readonly View[];
  currentViewId: string;
  /** Kinds the current view filters on; empty means all. */
  kinds: readonly ItemKind[];
  onClose: () => void;
  onNamePort: () => void;
  onRename: (route: Route) => void;
  onToggleFavorite: (route: Route) => void;
  onMoveToGroup: (route: Route) => void;
  onStopServer: (route: Route) => void;
  onSwitchView: (id: string) => void;
  onSaveView: () => void;
  onToggleKind: (kind: ItemKind) => void;
  onToggleTheme: () => void;
  onFocusFilter: () => void;
  onOpenSettings: () => void;
  onOpenHealth: () => void;
  onShowShortcuts: () => void;
  onStopStudio: () => void;
  /** Whether the proxy runs, which decides between Start and Stop/Restart. */
  proxyRunning: boolean;
  onProxyAction: (action: ProxyAction) => void;
};

/** Cmd/Ctrl+K: jump to any route or run any action without leaving the keyboard. */
export function RouteCommandMenu(props: RouteCommandMenuProps) {
  const { selected } = props;
  const actions = useRouteActions();
  const modifier = modifierLabel();
  const keys = (id: ShortcutId) => <Kbd>{shortcutKeys(id, modifier).join(" ")}</Kbd>;
  const when = (condition: boolean, items: CommandItem[]) => (condition ? items : []);

  const items: CommandItem[] = [
    ...props.routes.map(
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
      shortcut: keys("name-port"),
      onSelect: props.onNamePort,
    },
    ...(selected
      ? [
          {
            id: "copy-selected",
            group: "Actions",
            label: `Copy URL of ${selected.name}`,
            icon: "copy",
            shortcut: keys("copy"),
            onSelect: () => void actions.copyUrl(selected),
          } satisfies CommandItem,
          {
            id: "favorite-selected",
            group: "Actions",
            label: props.selectedIsFavorite
              ? `Unpin ${selected.name}`
              : `Pin ${selected.name} to favorites`,
            icon: "star",
            shortcut: keys("favorite"),
            onSelect: () => props.onToggleFavorite(selected),
          } satisfies CommandItem,
          {
            id: "move-selected",
            group: "Actions",
            label: `Move ${selected.name} to a group…`,
            icon: "folder",
            onSelect: () => props.onMoveToGroup(selected),
          } satisfies CommandItem,
        ]
      : []),
    ...when(selected?.kind === "alias", [
      {
        id: "rename-selected",
        group: "Actions",
        label: `Rename ${selected?.name}`,
        icon: "pencil",
        shortcut: keys("rename"),
        onSelect: () => selected && props.onRename(selected),
      },
    ]),
    ...when(selected?.listenerPid !== undefined, [
      {
        id: "stop-selected",
        group: "Actions",
        label: `Stop the server of ${selected?.name}…`,
        icon: "power",
        onSelect: () => selected && props.onStopServer(selected),
      },
    ]),
    {
      id: "filter",
      group: "Actions",
      label: "Search routes",
      icon: "search",
      shortcut: keys("focus-filter"),
      onSelect: props.onFocusFilter,
    },
    ...props.views
      .filter((view) => view.id !== props.currentViewId)
      .map(
        (view): CommandItem => ({
          id: `view-${view.id}`,
          group: "Views",
          label: `Switch to view ${view.name}`,
          icon: "layers",
          onSelect: () => props.onSwitchView(view.id),
        }),
      ),
    {
      id: "sshop-view",
      group: "Views",
      label: "Save as new view…",
      icon: "layers",
      onSelect: props.onSaveView,
    },
    ...ITEM_KINDS.map(
      (kind): CommandItem => ({
        id: `kind-${kind}`,
        group: "Views",
        label: props.kinds.includes(kind)
          ? `Stop filtering by ${KIND_LABELS[kind].toLowerCase()}`
          : `Filter by kind: ${KIND_LABELS[kind]}`,
        icon: "search",
        onSelect: () => props.onToggleKind(kind),
      }),
    ),
    ...(props.proxyRunning
      ? [
          {
            id: "proxy-restart",
            group: "Proxy",
            label: "Restart proxy",
            icon: "refresh",
            onSelect: () => props.onProxyAction("restart"),
          } satisfies CommandItem,
          {
            id: "proxy-stop",
            group: "Proxy",
            label: "Stop proxy",
            icon: "power",
            onSelect: () => props.onProxyAction("stop"),
          } satisfies CommandItem,
        ]
      : [
          {
            id: "proxy-start",
            group: "Proxy",
            label: "Start proxy",
            icon: "power",
            onSelect: () => props.onProxyAction("start"),
          } satisfies CommandItem,
        ]),
    {
      id: "health",
      group: "App",
      label: "Open health panel",
      icon: "activity",
      onSelect: props.onOpenHealth,
    },
    {
      id: "settings",
      group: "App",
      label: "Open settings",
      icon: "settings",
      shortcut: keys("settings"),
      onSelect: props.onOpenSettings,
    },
    {
      id: "shortcuts",
      group: "App",
      label: "Show keyboard shortcuts",
      icon: "keyboard",
      shortcut: keys("help"),
      onSelect: props.onShowShortcuts,
    },
    {
      id: "theme",
      group: "App",
      label: "Toggle theme",
      icon: "moon",
      onSelect: props.onToggleTheme,
    },
    {
      id: "stop-studio",
      group: "App",
      label: "Stop Studio…",
      icon: "power",
      onSelect: props.onStopStudio,
    },
  ];

  return (
    <CommandMenu items={items} onClose={props.onClose} placeholder="Search routes and actions" />
  );
}
