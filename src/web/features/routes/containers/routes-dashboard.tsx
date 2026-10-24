import { useEffect, useRef, useState } from "react";
import type { StudioActionResponse } from "../../../../core/api/contract.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
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
import type { RowConfirmation } from "../components/route-row.tsx";
import { ShortcutHints } from "../components/shortcut-hints.tsx";
import { StudioStopped } from "../components/studio-stopped.tsx";
import { apiErrorMessage } from "../hooks/route-messages.ts";
import { useDoctor } from "../hooks/use-doctor.ts";
import { useFilter } from "../hooks/use-filter.ts";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation.ts";
import { useNow } from "../hooks/use-now.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useRoutes } from "../hooks/use-routes.ts";
import { useServiceControl } from "../hooks/use-service-control.ts";
import { useStopProcess } from "../hooks/use-stop-process.ts";
import { AliasDialogContainer, type AliasDialogRequest } from "./alias-dialog-container.tsx";
import { DetectedContainer } from "./detected-container.tsx";
import { HealthPanelContainer } from "./health-panel-container.tsx";
import { InstallPortlessContainer } from "./install-portless-container.tsx";
import { RouteCommandMenu } from "./route-command-menu.tsx";
import styles from "./routes-dashboard.module.css";
import { SettingsDialogContainer } from "./settings-dialog-container.tsx";

type RoutesDashboardProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
};

const NO_ROUTES: Route[] = [];
const NO_DETECTED: DetectedPort[] = [];

/**
 * The whole routes screen: header, filter, detected ports, live list, dialogs and keyboard
 * shortcuts.
 */
export function RoutesDashboard({ theme, onToggleTheme }: RoutesDashboardProps) {
  const { snapshot, error, connection, reload } = useRoutes();
  const routes = snapshot?.routes ?? NO_ROUTES;
  // Optional chaining tolerates a server older than the `portless` field.
  const portlessMissing = snapshot?.portless?.installed === false;
  // Naming needs portless, so detected ports wait until it is installed.
  const detected = portlessMissing ? NO_DETECTED : (snapshot?.detected ?? NO_DETECTED);
  const filter = useFilter(routes, detected);
  const actions = useRouteActions();
  const toast = useToast();
  const now = useNow();
  const proxy = snapshot?.proxy ?? null;
  // Run the checks again whenever the proxy changes: most problems are about it.
  const doctor = useDoctor(proxy ? `${proxy.running}:${proxy.port}:${proxy.https}` : "");
  const services = useServiceControl();
  const stopProcess = useStopProcess();

  const [dialog, setDialog] = useState<AliasDialogRequest | null>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [stopped, setStopped] = useState<StudioActionResponse | null>(null);
  const [confirming, setConfirming] = useState<{ name: string; action: RowConfirmation } | null>(
    null,
  );
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const modifier = modifierLabel();

  const hasRoutes = routes.length > 0;
  const hasDetected = detected.length > 0;
  const routeAt = (index: number) => filter.visible[index];
  const openCreate = () => setDialog({ mode: "create" });
  const openSettings = () => setSettingsOpen(true);
  const nameDetected = (item: DetectedPort) =>
    setDialog({
      mode: "create",
      port: item.port,
      ...(item.suggestedName ? { name: item.suggestedName } : {}),
    });
  const requestRename = (route: Route) => {
    if (route.kind === "alias") setDialog({ mode: "rename", route });
    else
      toast({
        title: `${route.name} is an app`,
        description: "Apps take their name from the command that started them.",
      });
  };
  const requestRemove = (route: Route) => {
    if (route.kind === "alias") setConfirming({ name: route.name, action: "remove" });
    else
      toast({
        title: `${route.name} is an app`,
        description: "It goes away when its dev server stops.",
      });
  };
  const confirmRowAction = async (route: Route, action: RowConfirmation) => {
    setConfirming(null);
    if (action === "remove") await actions.removeAlias(route);
    else if (route.listenerPid !== undefined) {
      await stopProcess({ pid: route.listenerPid, port: route.port });
    }
  };
  const proxyAction = (action: "start" | "stop" | "restart") => {
    void services.controlProxy(action).then(() => doctor.refresh());
  };

  const navigation = useKeyboardNavigation({
    itemCount: filter.visible.length,
    enabled:
      dialog === null && !commandMenuOpen && !settingsOpen && !healthOpen && snapshot !== null,
    onOpen: (index) => withRoute(routeAt(index), actions.open),
    onCopy: (index) => withRoute(routeAt(index), (route) => void actions.copyUrl(route)),
    onRename: (index) => withRoute(routeAt(index), requestRename),
    onRemove: (index) => withRoute(routeAt(index), requestRemove),
    onCreate: openCreate,
    onFocusFilter: () => filterInput.current?.focus(),
    onToggleCommandMenu: () => setCommandMenuOpen((open) => !open),
    onOpenSettings: openSettings,
    onEscape: () => setConfirming(null),
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

  if (stopped) {
    return (
      <StudioStopped
        startCommand={stopped.startCommand}
        onCopy={(command) => void actions.copyCommand(command)}
      />
    );
  }

  return (
    <div className={styles.page}>
      <DashboardHeader
        proxy={snapshot?.proxy ?? null}
        portlessVersion={snapshot?.portless?.version ?? null}
        connection={connection}
        autoName={snapshot?.autoName ?? false}
        theme={theme}
        modifierLabel={modifier}
        onToggleTheme={onToggleTheme}
        onOpenCommandMenu={() => setCommandMenuOpen(true)}
        onNamePort={openCreate}
        onOpenSettings={openSettings}
        health={doctor.status}
        healthLabel={doctor.label}
        onOpenHealth={() => setHealthOpen(true)}
        proxyBusy={services.proxyBusy}
        onProxyAction={proxyAction}
      />

      <main className={styles.main}>
        {portlessMissing ? (
          <InstallPortlessContainer
            onCopyCommand={(command) => void actions.copyCommand(command)}
          />
        ) : null}
        {/* Without portless the proxy cannot run; the install banner already says what to do. */}
        {snapshot && !portlessMissing && !snapshot.proxy.running ? <ProxyBanner /> : null}

        {!snapshot && error ? (
          <ErrorState message={apiErrorMessage(error)} onRetry={() => void reload()} />
        ) : null}
        {!snapshot && !error ? <LoadingRows /> : null}

        {snapshot && !portlessMissing && !hasRoutes && !hasDetected ? (
          <EmptyState
            onCopyCommand={(command) => void actions.copyCommand(command)}
            onNamePort={openCreate}
          />
        ) : null}

        {snapshot && (hasRoutes || hasDetected) ? (
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
            {filter.visibleDetected.length > 0 ? (
              <DetectedContainer
                visible={filter.visibleDetected}
                totalCount={detected.length}
                autoName={snapshot.autoName}
                onName={nameDetected}
              />
            ) : null}
            {hasRoutes && hasDetected ? <h2 className={styles.sectionTitle}>Routes</h2> : null}
            <div ref={list}>
              {!hasRoutes ? null : filter.visible.length > 0 ? (
                <RouteList
                  routes={filter.visible}
                  now={now}
                  selectedIndex={navigation.selectedIndex}
                  confirming={confirming}
                  onSelect={navigation.select}
                  onOpen={actions.open}
                  onCopy={(route) => void actions.copyUrl(route)}
                  onRename={requestRename}
                  onRequestRemove={requestRemove}
                  onRequestStop={(route) => setConfirming({ name: route.name, action: "stop" })}
                  onConfirm={(route, action) => void confirmRowAction(route, action)}
                  onCancelConfirm={() => setConfirming(null)}
                />
              ) : (
                <NoMatches query={filter.query} onClear={() => setQuery("")} />
              )}
              {!hasRoutes && filter.visibleDetected.length === 0 ? (
                <NoMatches query={filter.query} onClear={() => setQuery("")} />
              ) : null}
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

      {settingsOpen ? <SettingsDialogContainer onClose={() => setSettingsOpen(false)} /> : null}

      {healthOpen ? (
        <HealthPanelContainer
          doctor={doctor}
          services={services}
          onStudioStopped={setStopped}
          onClose={() => setHealthOpen(false)}
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
          onOpenSettings={openSettings}
          onOpenHealth={() => setHealthOpen(true)}
          proxyRunning={snapshot?.proxy.running ?? false}
          onProxyAction={proxyAction}
        />
      ) : null}
    </div>
  );
}

function withRoute(route: Route | undefined, action: (route: Route) => void) {
  if (route) action(route);
}
