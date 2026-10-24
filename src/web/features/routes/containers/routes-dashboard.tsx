import { useEffect, useRef, useState } from "react";
import type { Route } from "../../../../core/routes/route.ts";
import { modifierLabel } from "../../../shared/lib/keyboard.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { DashboardHeader } from "../components/dashboard-header.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { ErrorState } from "../components/error-state.tsx";
import { FilterBar } from "../components/filter-bar.tsx";
import { LoadingRows } from "../components/loading-rows.tsx";
import { NoMatches } from "../components/no-matches.tsx";
import { ProxyBanner } from "../components/proxy-banner.tsx";
import { RouteList } from "../components/route-list.tsx";
import { ShortcutHints } from "../components/shortcut-hints.tsx";
import { apiErrorMessage } from "../hooks/route-messages.ts";
import { useFilter } from "../hooks/use-filter.ts";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation.ts";
import { useNow } from "../hooks/use-now.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useRoutes } from "../hooks/use-routes.ts";
import { AliasDialogContainer, type AliasDialogRequest } from "./alias-dialog-container.tsx";
import { RouteCommandMenu } from "./route-command-menu.tsx";
import styles from "./routes-dashboard.module.css";

type RoutesDashboardProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
};

const NO_ROUTES: Route[] = [];

/** The whole routes screen: header, filter, live list, dialogs and keyboard shortcuts. */
export function RoutesDashboard({ theme, onToggleTheme }: RoutesDashboardProps) {
  const { snapshot, error, connection, reload } = useRoutes();
  const routes = snapshot?.routes ?? NO_ROUTES;
  const filter = useFilter(routes);
  const actions = useRouteActions();
  const toast = useToast();
  const now = useNow();

  const [dialog, setDialog] = useState<AliasDialogRequest | null>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const modifier = modifierLabel();

  const routeAt = (index: number) => filter.visible[index];
  const openCreate = () => setDialog({ mode: "create" });
  const requestRename = (route: Route) => {
    if (route.kind === "alias") setDialog({ mode: "rename", route });
    else
      toast({
        title: `${route.name} is an app`,
        description: "Apps take their name from the command that started them.",
      });
  };
  const requestRemove = (route: Route) => {
    if (route.kind === "alias") setConfirmingRemove(route.name);
    else
      toast({
        title: `${route.name} is an app`,
        description: "It goes away when its dev server stops.",
      });
  };
  const confirmRemove = async (route: Route) => {
    setConfirmingRemove(null);
    await actions.removeAlias(route);
  };

  const navigation = useKeyboardNavigation({
    itemCount: filter.visible.length,
    enabled: dialog === null && !commandMenuOpen && snapshot !== null,
    onOpen: (index) => withRoute(routeAt(index), actions.open),
    onCopy: (index) => withRoute(routeAt(index), (route) => void actions.copyUrl(route)),
    onRename: (index) => withRoute(routeAt(index), requestRename),
    onRemove: (index) => withRoute(routeAt(index), requestRemove),
    onCreate: openCreate,
    onFocusFilter: () => filterInput.current?.focus(),
    onToggleCommandMenu: () => setCommandMenuOpen((open) => !open),
    onEscape: () => setConfirmingRemove(null),
  });
  const selected = routeAt(navigation.selectedIndex) ?? null;

  useEffect(() => {
    if (navigation.selectedIndex < 0) return;
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [navigation.selectedIndex]);

  const setQuery = (query: string) => {
    filter.setQuery(query);
    navigation.select(0);
  };

  return (
    <div className={styles.page}>
      <DashboardHeader
        proxy={snapshot?.proxy ?? null}
        connection={connection}
        theme={theme}
        modifierLabel={modifier}
        onToggleTheme={onToggleTheme}
        onOpenCommandMenu={() => setCommandMenuOpen(true)}
        onNamePort={openCreate}
      />

      <main className={styles.main}>
        {snapshot && !snapshot.proxy.running ? <ProxyBanner /> : null}

        {!snapshot && error ? (
          <ErrorState message={apiErrorMessage(error)} onRetry={() => void reload()} />
        ) : null}
        {!snapshot && !error ? <LoadingRows /> : null}

        {snapshot && routes.length === 0 ? (
          <EmptyState
            onCopyCommand={(command) => void actions.copyCommand(command)}
            onNamePort={openCreate}
          />
        ) : null}

        {snapshot && routes.length > 0 ? (
          <>
            <FilterBar
              query={filter.query}
              onQueryChange={setQuery}
              visibleCount={filter.visible.length}
              totalCount={routes.length}
              sort={filter.sort}
              onSortChange={filter.setSort}
              inputRef={filterInput}
            />
            <div ref={list}>
              {filter.visible.length > 0 ? (
                <RouteList
                  routes={filter.visible}
                  now={now}
                  selectedIndex={navigation.selectedIndex}
                  confirmingRemove={confirmingRemove}
                  onSelect={navigation.select}
                  onOpen={actions.open}
                  onCopy={(route) => void actions.copyUrl(route)}
                  onRename={requestRename}
                  onRequestRemove={requestRemove}
                  onConfirmRemove={(route) => void confirmRemove(route)}
                  onCancelRemove={() => setConfirmingRemove(null)}
                />
              ) : (
                <NoMatches query={filter.query} onClear={() => setQuery("")} />
              )}
            </div>
            <ShortcutHints modifierLabel={modifier} />
          </>
        ) : null}
      </main>

      {dialog && snapshot ? (
        <AliasDialogContainer
          request={dialog}
          proxy={snapshot.proxy}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {commandMenuOpen ? (
        <RouteCommandMenu
          routes={routes}
          selected={selected}
          onClose={() => setCommandMenuOpen(false)}
          onNamePort={openCreate}
          onRename={requestRename}
          onToggleTheme={onToggleTheme}
          onFocusFilter={() => filterInput.current?.focus()}
        />
      ) : null}
    </div>
  );
}

function withRoute(route: Route | undefined, action: (route: Route) => void) {
  if (route) action(route);
}
