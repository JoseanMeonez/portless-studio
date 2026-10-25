import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StudioActionResponse } from "../../../../core/api/contract.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { directUrl } from "../../../../core/ports/direct-url.ts";
import type { Route } from "../../../../core/routes/route.ts";
import { hasFilters, type ItemKind, routeKey } from "../../../../core/views/view.ts";
import { modifierLabel } from "../../../shared/lib/keyboard.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { DashboardHeader } from "../components/dashboard-header.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { ErrorState } from "../components/error-state.tsx";
import { FilterBar } from "../components/filter-bar.tsx";
import { LoadingRows } from "../components/loading-rows.tsx";
import { MoveToGroupDialog } from "../components/move-to-group-dialog.tsx";
import { NameDialog } from "../components/name-dialog.tsx";
import { NoMatches } from "../components/no-matches.tsx";
import { NotificationsMenu } from "../components/notifications-menu.tsx";
import { ProxyBanner } from "../components/proxy-banner.tsx";
import { RouteList } from "../components/route-list.tsx";
import type { RowConfirmation } from "../components/route-row.tsx";
import type { MenuPoint } from "../components/row-menu-trigger.ts";
import { ShortcutHints } from "../components/shortcut-hints.tsx";
import { ShortcutsDialog } from "../components/shortcuts-dialog.tsx";
import { StudioStopped } from "../components/studio-stopped.tsx";
import { ViewControls } from "../components/view-controls.tsx";
import { ViewMenu } from "../components/view-menu.tsx";
import { readLastSelected, storeLastSelected } from "../hooks/last-selected.ts";
import { apiErrorMessage } from "../hooks/route-messages.ts";
import { useRoutesGateway } from "../hooks/routes-gateway-context.tsx";
import { useDoctor } from "../hooks/use-doctor.ts";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation.ts";
import { type ItemTarget, parseFocus, useNotifications } from "../hooks/use-notifications.ts";
import { useNow } from "../hooks/use-now.ts";
import { useOpenWith } from "../hooks/use-open-with.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useRouteViews } from "../hooks/use-route-views.ts";
import { useRoutes } from "../hooks/use-routes.ts";
import { useServiceControl } from "../hooks/use-service-control.ts";
import { useStopProcess } from "../hooks/use-stop-process.ts";
import { AliasDialogContainer, type AliasDialogRequest } from "./alias-dialog-container.tsx";
import { DetectedContainer } from "./detected-container.tsx";
import { HealthPanelContainer } from "./health-panel-container.tsx";
import { InstallPortlessContainer } from "./install-portless-container.tsx";
import { RouteCommandMenu } from "./route-command-menu.tsx";
import styles from "./routes-dashboard.module.css";
import {
  RowMenuContainer,
  type RowMenuRequest,
  type RowMenuTarget,
} from "./row-menu-container.tsx";
import { SettingsDialogContainer } from "./settings-dialog-container.tsx";
import { UpdateBannerContainer } from "./update-banner-container.tsx";

/** What the dashboard asks of the terminals feature; the app root wires it in. */
export type TerminalLauncher = {
  /**
   * Shows a terminal for an item: the running one whose processes listen on `port`, else one in
   * this folder, else a new shell there.
   */
  openIn: (folder: string, port?: number) => void;
  /** Shows the terminal with this id. */
  show: (id: string) => void;
  /** Opens the New terminal picker: any project folder, or one typed by hand. */
  pick: () => void;
};

type RoutesDashboardProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** Without it the row menu and the `t` shortcut offer no terminal. */
  terminals?: TerminalLauncher | undefined;
  /** Draws the terminal panel, given the project folders a new terminal can run in. */
  terminalPanel?: ((folders: readonly ProjectFolder[]) => ReactNode) | undefined;
};

/** A project folder Studio shows, for starting a terminal there. */
export type ProjectFolder = {
  /** `acme-monorepo / falcon` for a linked worktree, else the project name. */
  label: string;
  path: string;
  branch: string | null;
};

/** How long a page waits after `window.focus()` before saying whether it came forward. */
const FOCUS_CHECK_MS = 300;

const NO_ROUTES: Route[] = [];
const NO_DETECTED: DetectedPort[] = [];

/** Dialogs that ask for one name. */
type NameRequest =
  | { kind: "save-view" }
  | { kind: "rename-view" }
  | { kind: "rename-group"; groupId: string; name: string };

/**
 * The whole routes screen: header, filter, detected ports, live list, dialogs and keyboard
 * shortcuts.
 */
export function RoutesDashboard({
  theme,
  onToggleTheme,
  terminals,
  terminalPanel,
}: RoutesDashboardProps) {
  const { snapshot, error, connection, reload, events, focus } = useRoutes();
  const gateway = useRoutesGateway();
  const routes = snapshot?.routes ?? NO_ROUTES;
  // Optional chaining tolerates a server older than the `portless` field.
  const portlessMissing = snapshot?.portless?.installed === false;
  // Naming needs portless, so detected ports wait until it is installed.
  const detected = portlessMissing ? NO_DETECTED : (snapshot?.detected ?? NO_DETECTED);
  const views = useRouteViews(routes, detected);
  const { state: viewState, config: viewsConfig } = views;
  const actions = useRouteActions();
  const toast = useToast();
  const now = useNow();
  const proxy = snapshot?.proxy ?? null;
  // Run the checks again whenever the proxy changes: most problems are about it.
  const doctor = useDoctor(
    proxy ? `${proxy.running}:${proxy.port}:${proxy.https}:${proxy.publicPort ?? ""}` : "",
  );
  const services = useServiceControl();
  const stopProcess = useStopProcess();

  const [dialog, setDialog] = useState<AliasDialogRequest | null>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [stopped, setStopped] = useState<StudioActionResponse | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [naming, setNaming] = useState<NameRequest | null>(null);
  const [moving, setMoving] = useState<Route | null>(null);
  const [rowMenu, setRowMenu] = useState<RowMenuRequest | null>(null);
  const openWith = useOpenWith(rowMenu !== null);
  const [confirming, setConfirming] = useState<{ name: string; action: RowConfirmation } | null>(
    null,
  );
  /** The item a notification asked to show, until it is on screen and selected. */
  const [showing, setShowing] = useState<ItemTarget | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const notifications = useNotifications(events, (target) => setShowing({ ...target }));
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const modifier = modifierLabel();

  const hasRoutes = routes.length > 0;
  const hasDetected = detected.length > 0;
  const routeAt = (index: number): Route | undefined => views.ordered[index];
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
  const toggleFavorite = (route: Route) => void viewsConfig.toggleFavorite(route);
  const openTerminal = (route: Route) => {
    if (!terminals) return;
    const folder = route.project?.path;
    if (folder) terminals.openIn(folder, route.port);
    else
      toast({
        title: `No folder for ${route.name}`,
        description:
          "Studio has not seen the process behind this route, so it does not know where it runs.",
      });
  };
  const collapseAll = () =>
    views.collapsed.collapseAll(views.sections.map((section) => section.key));

  const nextView = () => {
    const list = viewsConfig.views;
    const at = list.findIndex((view) => view.id === viewState.saved.id);
    const next = list[(at + 1) % list.length];
    if (next && next.id !== viewState.saved.id) {
      viewState.switchView(next.id);
      toast({ title: `View: ${next.name}` });
    }
  };
  const toggleKind = (kind: ItemKind) => {
    const { filters } = viewState.view;
    viewState.setFilters({
      ...filters,
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((item) => item !== kind)
        : [...filters.kinds, kind],
    });
  };
  const clearSearchAndFilters = () => {
    setQuery("");
    if (hasFilters(viewState.view.filters))
      viewState.setFilters({ kinds: [], projects: [], statuses: [] });
  };
  const saveNamed = async (name: string) => {
    const request = naming;
    setNaming(null);
    if (!request) return;
    const { view, saved } = viewState;
    if (request.kind === "save-view") {
      const { id: _id, name: _name, ...settings } = view;
      const id = await viewsConfig.addView({ ...settings, name });
      if (id) {
        viewState.switchView(id);
        toast({ title: `Saved view ${name}`, tone: "success" });
      }
    } else if (request.kind === "rename-view") {
      await viewsConfig.renameView(saved.id, name);
    } else {
      await viewsConfig.renameGroup(saved.id, request.groupId, name);
    }
  };
  const deleteView = async () => {
    const { saved } = viewState;
    if (await viewsConfig.deleteView(saved.id)) {
      viewState.switchView(viewsConfig.defaultViewId);
      toast({ title: `Deleted view ${saved.name}` });
    }
  };
  const moveToGroup = async (route: Route, groupId: string | null, newName?: string) => {
    setMoving(null);
    const viewId = viewState.saved.id;
    const done = newName
      ? await viewsConfig.createGroup(viewId, newName, routeKey(route))
      : await viewsConfig.moveToGroup(viewId, routeKey(route), groupId);
    if (done && viewState.view.groupBy !== "custom") {
      toast({
        title: groupId === null && !newName ? "Taken out of its group" : "Moved",
        description: "Group by Custom groups to see your groups.",
      });
    }
  };
  const closeViewMenu = useCallback((open: boolean) => setViewMenuOpen(open), []);
  const changeFiltersOpen = useCallback((open: boolean) => setFiltersOpen(open), []);
  const routeMenu = (route: Route, point: MenuPoint) =>
    setRowMenu({ target: routeMenuTarget(route), ...point });
  const detectedMenu = (item: DetectedPort, point: MenuPoint) =>
    setRowMenu({ target: detectedMenuTarget(item), ...point });
  /** From the keyboard: the menu opens under the selected row. */
  const selectedRowMenu = (route: Route) => {
    const row = list.current?.querySelector('[aria-current="true"]');
    const rect = row?.getBoundingClientRect();
    routeMenu(route, rect ? { x: rect.left + 48, y: rect.bottom } : { x: 48, y: 120 });
  };

  const overlayOpen =
    dialog !== null ||
    commandMenuOpen ||
    settingsOpen ||
    healthOpen ||
    viewMenuOpen ||
    filtersOpen ||
    shortcutsOpen ||
    naming !== null ||
    moving !== null ||
    rowMenu !== null;
  const navigation = useKeyboardNavigation({
    itemCount: views.ordered.length,
    enabled: !overlayOpen && snapshot !== null,
    onOpen: (index) => withRoute(routeAt(index), actions.open),
    onCopy: (index) => withRoute(routeAt(index), (route) => void actions.copyUrl(route)),
    onRename: (index) => withRoute(routeAt(index), requestRename),
    onRemove: (index) => withRoute(routeAt(index), requestRemove),
    onFavorite: (index) => withRoute(routeAt(index), toggleFavorite),
    onRowMenu: (index) => withRoute(routeAt(index), selectedRowMenu),
    onTerminal: (index) => withRoute(routeAt(index), openTerminal),
    onCreate: openCreate,
    onNewTerminal: () => terminals?.pick(),
    onFocusFilter: () => filterInput.current?.focus(),
    onToggleCommandMenu: () => setCommandMenuOpen((open) => !open),
    onOpenSettings: openSettings,
    onNextView: nextView,
    onCollapseAll: collapseAll,
    onExpandAll: views.collapsed.expandAll,
    onOpenViewMenu: () => setViewMenuOpen(true),
    onOpenFilters: () => setFiltersOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
    onEscape: () => setConfirming(null),
  });
  const selected = routeAt(navigation.selectedIndex) ?? null;
  const selectRoute = (route: Route) => navigation.select(views.ordered.indexOf(route));

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollRequest asks for a scroll even when the selection stays put.
  useEffect(() => {
    if (navigation.selectedIndex < 0) return;
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [navigation.selectedIndex, scrollRequest]);

  // The selection follows its route when the rows reorder (a favorite moves up, a view changes),
  // and starts on the route selected before the last reload.
  const followed = useRef<string | null>(readLastSelected());
  const lastOrdered = useRef<readonly Route[]>([]);
  const { select } = navigation;
  useLayoutEffect(() => {
    if (lastOrdered.current !== views.ordered) {
      lastOrdered.current = views.ordered;
      const name = followed.current;
      const index = name === null ? -1 : views.ordered.findIndex((route) => route.name === name);
      if (index >= 0 && index !== navigation.selectedIndex) {
        select(index);
        return;
      }
    }
    // With no rows yet (still loading) keep following the remembered route.
    if (views.ordered.length > 0) followed.current = selected?.name ?? null;
  });
  const selectedName = selected?.name ?? null;
  useEffect(() => {
    if (selectedName) storeLastSelected(selectedName);
  }, [selectedName]);

  const setQuery = (query: string) => {
    viewState.setQuery(query);
    // A new search starts at its best match, wherever the old selection went.
    followed.current = null;
    navigation.select(0);
  };

  // A system notification opens Studio with `?focus=`, `portless-studio open` with `?focus=` or
  // `?terminal=`; show that item once, then drop the param.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on the link the page opened with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = parseFocus(params.get("focus"));
    const terminal = params.get("terminal");
    if (!target && !terminal) return;
    params.delete("focus");
    params.delete("terminal");
    const rest = params.toString();
    const { pathname, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${rest ? `?${rest}` : ""}${hash}`);
    if (target) setShowing(target);
    if (terminal) terminals?.show(terminal);
  }, []);

  // `portless-studio open` and the MCP `focus_studio` tool: show the target, ask the browser to
  // raise this window, and tell Studio whether it did, so it can open a link instead.
  const answeredFocus = useRef<string | null>(null);
  const launcher = useRef(terminals);
  launcher.current = terminals;
  useEffect(() => {
    if (!focus || answeredFocus.current === focus.id) return;
    answeredFocus.current = focus.id;
    const { terminal, route, port } = focus.target;
    if (terminal !== undefined) launcher.current?.show(terminal);
    else if (route !== undefined || port !== undefined) {
      setShowing({
        ...(route === undefined ? {} : { route }),
        ...(port === undefined ? {} : { port }),
      });
    }
    window.focus();
    // Not cleared on re-render: the answer must reach Studio, which waits for it.
    setTimeout(() => {
      const focused = document.visibilityState === "visible" && document.hasFocus();
      void gateway.acknowledgeFocus?.({ id: focus.id, focused });
    }, FOCUS_CHECK_MS);
  }, [focus, gateway]);

  // Brings the item a notification points at on screen one step per render: clear the search and
  // filters that hide it, open its group, then select and scroll to it.
  useEffect(() => {
    if (!showing || !snapshot) return;
    const route =
      routes.find((item) => item.name === showing.route) ??
      routes.find((item) => item.port === showing.port);
    const hidden = viewState.query !== "" || hasFilters(viewState.view.filters);
    if (route) {
      const index = views.ordered.indexOf(route);
      if (index >= 0) {
        followed.current = route.name;
        navigation.select(index);
        setScrollRequest((count) => count + 1);
        setShowing(null);
        return;
      }
      const section = views.sections.find((item) => item.routes.includes(route));
      if (section && views.collapsed.isCollapsed(section.key)) views.collapsed.toggle(section.key);
      else if (hidden) clearSearchAndFilters();
      else setShowing(null);
      return;
    }
    const item = detected.find((port) => port.port === showing.port);
    if (item && !views.visibleDetected.includes(item) && hidden) {
      clearSearchAndFilters();
      return;
    }
    setShowing(null);
    if (item) {
      document.querySelector(`[data-port="${item.port}"]`)?.scrollIntoView?.({ block: "center" });
    } else {
      toast({ title: "Not here anymore", description: "That server or name is gone." });
    }
  });

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
        notifications={
          <NotificationsMenu
            events={notifications.recent}
            unread={notifications.unread}
            onOpen={notifications.markRead}
            onSelect={(event) => setShowing({ ...event.target })}
          />
        }
      />

      <main className={styles.main}>
        <UpdateBannerContainer onCopyCommand={(command) => void actions.copyCommand(command)} />
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
              query={viewState.query}
              onQueryChange={setQuery}
              visibleCount={views.matched}
              totalCount={routes.length}
              narrowed={hasFilters(viewState.view.filters)}
              inputRef={filterInput}
              leading={
                <ViewMenu
                  views={viewsConfig.views}
                  currentId={viewState.saved.id}
                  defaultViewId={viewsConfig.defaultViewId}
                  modified={viewState.modified}
                  open={viewMenuOpen}
                  onOpenChange={closeViewMenu}
                  onSwitch={viewState.switchView}
                  onSaveAs={() => setNaming({ kind: "save-view" })}
                  onSaveChanges={() =>
                    void viewsConfig
                      .replaceView(viewState.saved.id, viewState.view)
                      .then((saved) => saved && viewState.resetChanges())
                  }
                  onResetChanges={viewState.resetChanges}
                  onRename={() => setNaming({ kind: "rename-view" })}
                  onSetDefault={() => void viewsConfig.setDefaultView(viewState.saved.id)}
                  onDelete={() => void deleteView()}
                />
              }
            />
            <ViewControls
              view={viewState.view}
              projects={views.projects}
              projectIcons={snapshot.projectIcons}
              filtersOpen={filtersOpen}
              onFiltersOpenChange={changeFiltersOpen}
              onGroupByChange={viewState.setGroupBy}
              onSortChange={viewState.setSort}
              onFiltersChange={viewState.setFilters}
              onCollapseAll={collapseAll}
              onExpandAll={views.collapsed.expandAll}
            />
            {views.visibleDetected.length > 0 ? (
              <DetectedContainer
                visible={views.visibleDetected}
                totalCount={detected.length}
                autoName={snapshot.autoName}
                onName={nameDetected}
                onMenu={detectedMenu}
                onOpenTerminal={
                  terminals ? (item, folder) => terminals.openIn(folder, item.port) : undefined
                }
              />
            ) : null}
            {hasRoutes && hasDetected ? <h2 className={styles.sectionTitle}>Routes</h2> : null}
            <div ref={list}>
              {!hasRoutes ? null : views.matched > 0 ? (
                <RouteList
                  sections={views.sections}
                  projectIcons={snapshot.projectIcons}
                  now={now}
                  selectedName={selected?.name ?? null}
                  isFavorite={views.isFavorite}
                  isCollapsed={views.collapsed.isCollapsed}
                  onToggleSection={views.collapsed.toggle}
                  confirming={confirming}
                  onSelect={selectRoute}
                  onOpen={actions.open}
                  onCopy={(route) => void actions.copyUrl(route)}
                  onRename={requestRename}
                  onRequestRemove={requestRemove}
                  onRequestStop={(route) => setConfirming({ name: route.name, action: "stop" })}
                  onConfirm={(route, action) => void confirmRowAction(route, action)}
                  onCancelConfirm={() => setConfirming(null)}
                  onToggleFavorite={toggleFavorite}
                  onMoveToGroup={setMoving}
                  onMenu={routeMenu}
                  onCopyDirectUrl={(route) => void actions.copyDirectUrl(route.port)}
                  onOpenTerminal={terminals ? openTerminal : undefined}
                  canOpenTerminal={(route) => Boolean(route.project?.path)}
                  onRenameGroup={(groupId, name) =>
                    setNaming({ kind: "rename-group", groupId, name })
                  }
                  onDeleteGroup={(groupId, name) =>
                    void viewsConfig
                      .deleteGroup(viewState.saved.id, groupId)
                      .then((done) => done && toast({ title: `Deleted group ${name}` }))
                  }
                />
              ) : (
                <NoMatches query={viewState.query} onClear={clearSearchAndFilters} />
              )}
              {!hasRoutes && views.visibleDetected.length === 0 ? (
                <NoMatches query={viewState.query} onClear={clearSearchAndFilters} />
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

      {settingsOpen ? (
        <SettingsDialogContainer
          projects={knownProjects(routes, detected)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {healthOpen ? (
        <HealthPanelContainer
          doctor={doctor}
          services={services}
          onStudioStopped={setStopped}
          onClose={() => setHealthOpen(false)}
        />
      ) : null}

      {shortcutsOpen ? (
        <ShortcutsDialog modifierLabel={modifier} onClose={() => setShortcutsOpen(false)} />
      ) : null}

      {naming ? (
        <NameDialog
          {...nameDialogText(naming, viewState.saved.name)}
          onSubmit={(name) => void saveNamed(name)}
          onClose={() => setNaming(null)}
        />
      ) : null}

      {moving ? (
        <MoveToGroupDialog
          routeName={moving.name}
          viewName={viewState.saved.name}
          groups={viewState.saved.customGroups ?? []}
          currentGroupId={
            viewState.saved.customGroups?.find((group) => group.members.includes(routeKey(moving)))
              ?.id ?? null
          }
          onMove={(groupId) => void moveToGroup(moving, groupId)}
          onCreate={(name) => void moveToGroup(moving, null, name)}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {rowMenu && openWith.apps ? (
        <RowMenuContainer
          request={rowMenu}
          apps={openWith.apps}
          onOpenWith={(app, path) => void openWith.open(app, path)}
          onCustomize={openSettings}
          onOpenTerminal={terminals ? (path, port) => terminals.openIn(path, port) : undefined}
          onClose={() => setRowMenu(null)}
        />
      ) : null}

      {commandMenuOpen ? (
        <RouteCommandMenu
          routes={routes}
          selected={selected}
          selectedIsFavorite={selected ? views.isFavorite(selected) : false}
          views={viewsConfig.views}
          currentViewId={viewState.saved.id}
          kinds={viewState.view.filters.kinds}
          onClose={() => setCommandMenuOpen(false)}
          onNamePort={openCreate}
          onRename={requestRename}
          onToggleFavorite={toggleFavorite}
          onMoveToGroup={setMoving}
          onNewTerminal={terminals ? terminals.pick : undefined}
          onStopServer={(route) => {
            selectRoute(route);
            setConfirming({ name: route.name, action: "stop" });
          }}
          onSwitchView={viewState.switchView}
          onSaveView={() => setNaming({ kind: "save-view" })}
          onToggleKind={toggleKind}
          onOpenFilters={() => setFiltersOpen(true)}
          onToggleTheme={onToggleTheme}
          onFocusFilter={() => filterInput.current?.focus()}
          onOpenSettings={openSettings}
          onCollapseAll={collapseAll}
          onExpandAll={views.collapsed.expandAll}
          onOpenHealth={() => setHealthOpen(true)}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onStopStudio={() => setHealthOpen(true)}
          proxyRunning={snapshot?.proxy.running ?? false}
          onProxyAction={proxyAction}
        />
      ) : null}

      {terminalPanel?.(projectFolders(routes, detected))}
    </div>
  );
}

/** Every project folder of a route or detected port, once, by project name. */
function projectFolders(
  routes: readonly Route[],
  detected: readonly DetectedPort[],
): ProjectFolder[] {
  const folders = new Map<string, ProjectFolder>();
  for (const item of [...routes, ...detected]) {
    const path = item.project?.path;
    if (item.project && path && !folders.has(path)) {
      const worktree = item.project.worktree ? ` / ${item.project.worktree}` : "";
      folders.set(path, {
        label: `${item.project.name}${worktree}`,
        path,
        branch: item.project.branch ?? null,
      });
    }
  }
  return [...folders.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function routeMenuTarget(route: Route): RowMenuTarget {
  return {
    label: route.name,
    url: route.url,
    directUrl: directUrl(route.port),
    port: route.port,
    path: route.project?.path ?? null,
  };
}

function detectedMenuTarget(item: DetectedPort): RowMenuTarget {
  return {
    label: `port ${item.port}`,
    url: directUrl(item.port),
    directUrl: directUrl(item.port),
    port: item.port,
    path: item.project?.path ?? item.cwd,
  };
}

function withRoute(route: Route | undefined, action: (route: Route) => void) {
  if (route) action(route);
}

function nameDialogText(request: NameRequest, viewName: string) {
  if (request.kind === "save-view") {
    return {
      title: "Save as new view",
      description: "Keeps the current grouping, sort and filters under a name.",
      label: "View name",
      submitLabel: "Save view",
    };
  }
  if (request.kind === "rename-view") {
    return {
      title: "Rename view",
      label: "View name",
      initialName: viewName,
      submitLabel: "Rename",
    };
  }
  return {
    title: "Rename group",
    label: "Group name",
    initialName: request.name,
    submitLabel: "Rename",
  };
}

/** Every project a route or detected port runs from, sorted, for the icon settings. */
function knownProjects(
  routes: readonly { project?: { name: string } | null }[],
  detected: readonly { project?: { name: string } | null }[],
): string[] {
  const names = new Set<string>();
  for (const item of [...routes, ...detected]) if (item.project) names.add(item.project.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}
