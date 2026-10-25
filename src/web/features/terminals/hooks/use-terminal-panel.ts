import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError, CreateTerminalRequest } from "../../../../core/api/contract.ts";
import type { Result } from "../../../../core/result.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { useTerminalsGateway } from "./terminals-gateway-context.tsx";
import { useMediaQuery } from "./use-media-query.ts";
import { useTerminals } from "./use-terminals.ts";

export type TerminalDock = "bottom" | "right";

/** The New terminal picker: closed, the list of folders, or the field for any folder. */
export type TerminalPickerState = "closed" | "folders" | "other";

type Layout = {
  /** Where the person wants the terminals; the right pane needs a wide window. */
  dock: TerminalDock;
  /** Height of the bottom panel. */
  size: number;
  /** Width of the right pane. */
  rightSize: number;
  open: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
};

const LAYOUT_KEY = "portless-studio:terminal-panel";
export const MIN_PANEL_SIZE = 160;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 420;
/** The right pane sits next to the list only from this width; below it the panel docks at the bottom. */
export const WIDE_QUERY = "(min-width: 1100px)";
/** Below this width the terminal list becomes a dropdown. */
export const NARROW_QUERY = "(max-width: 480px)";

const DEFAULT_LAYOUT: Layout = {
  dock: "bottom",
  size: 320,
  rightSize: 560,
  open: false,
  sidebarWidth: 220,
  sidebarCollapsed: false,
};

/** A terminal as a row of the routes list sees it. */
export type PortTerminal = {
  id: string;
  title: string;
  running: boolean;
  exitCode: number | null;
};

/** The terminal panel: which terminal shows, where it docks and how big it is. */
export type TerminalPanelController = {
  terminals: TerminalInfo[];
  open: boolean;
  activeId: string | null;
  /** Where the panel shows now: the right pane only in a wide window. */
  dock: TerminalDock;
  /** Whether the window is wide enough for the right pane. */
  wide: boolean;
  /** Height when docked at the bottom, width when docked on the right, in pixels. */
  size: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /**
   * Shows a terminal for an item: the running one whose processes listen on `port`, else one in
   * this folder (a running one first), else a new shell there.
   */
  openIn(folder: string, port?: number): Promise<void>;
  /** The terminal whose processes serve `port` (or last did), for the routes list. */
  terminalForPort(port: number): PortTerminal | null;
  picker: TerminalPickerState;
  setPicker(state: TerminalPickerState): void;
  /** Opens a shell in a folder typed by hand; the error comes back for the form to show. */
  openTypedFolder(folder: string): Promise<Result<TerminalInfo, ApiError>>;
  /** Renames a terminal; an empty title gives back the default one. */
  rename(id: string, title: string): Promise<void>;
  stop(id: string): Promise<void>;
  /** Runs the command again: Restart, Run again, or the first run after a Studio restart. */
  restart(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  show(id: string): void;
  setOpen(open: boolean): void;
  setDock(dock: TerminalDock): void;
  setSize(size: number): void;
  setSidebarWidth(width: number): void;
  setSidebarCollapsed(collapsed: boolean): void;
  /** Starts a terminal and shows it; null when Studio refused (a toast says why). */
  create(request: CreateTerminalRequest): Promise<TerminalInfo | null>;
};

export function useTerminalPanel(): TerminalPanelController {
  const gateway = useTerminalsGateway();
  const terminals = useTerminals();
  const toast = useToast();
  // Without matchMedia (tests) the window counts as wide.
  const wide = useMediaQuery(WIDE_QUERY, true);
  const [layout, setLayout] = useState<Layout>(() => readLayout(wide));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<TerminalPickerState>("closed");
  const latest = useRef(terminals);
  latest.current = terminals;

  useEffect(() => storeLayout(layout), [layout]);

  // Ports a terminal served stay linked to it after its command ends, so its row still shows it.
  const servedPorts = useRef(new Map<string, Set<number>>());
  for (const terminal of terminals) {
    const ports = servedPorts.current.get(terminal.id) ?? new Set<number>();
    for (const item of terminal.ports ?? []) ports.add(item.port);
    if (terminal.naming?.port) ports.add(terminal.naming.port);
    servedPorts.current.set(terminal.id, ports);
  }

  // A closed terminal hands the panel to the next one. An id not listed yet is kept: the list
  // arrives on its own stream, often after the terminal a click or a link asked for.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const terminal of terminals) seen.current.add(terminal.id);
    if (activeId !== null && terminals.some((terminal) => terminal.id === activeId)) return;
    if (activeId !== null && !seen.current.has(activeId)) return;
    const next = terminals.at(-1)?.id ?? null;
    if (next !== activeId) setActiveId(next);
  }, [terminals, activeId]);

  const show = useCallback((id: string) => {
    setActiveId(id);
    setLayout((current) => ({ ...current, open: true }));
  }, []);

  const report = useCallback(
    (result: Result<unknown, ApiError>, title: string) => {
      if (!result.ok) toast({ title, description: result.error.message, tone: "error" });
    },
    [toast],
  );

  const create = useCallback(
    async (request: CreateTerminalRequest) => {
      const created = await gateway.create(request);
      if (!created.ok) {
        report(created, "Could not open a terminal");
        return null;
      }
      show(created.value.id);
      return created.value;
    },
    [gateway, report, show],
  );

  const terminalForPort = useCallback(
    (port: number): PortTerminal | null => {
      const serving = (terminal: TerminalInfo) =>
        terminal.status === "running" && (terminal.ports ?? []).some((item) => item.port === port);
      const found =
        terminals.find(serving) ??
        terminals.findLast((terminal) => servedPorts.current.get(terminal.id)?.has(port));
      return found
        ? {
            id: found.id,
            title: found.title,
            running: found.status === "running",
            exitCode: found.exitCode,
          }
        : null;
    },
    [terminals],
  );

  const openIn = useCallback(
    async (folder: string, port?: number) => {
      const serving =
        port === undefined
          ? undefined
          : latest.current.find(
              (terminal) =>
                terminal.status === "running" &&
                (terminal.ports ?? []).some((item) => item.port === port),
            );
      const here = latest.current.filter((terminal) => terminal.cwd === folder);
      const existing =
        serving ?? here.find((terminal) => terminal.status === "running") ?? here.at(-1);
      if (existing) {
        show(existing.id);
        return;
      }
      await create({ cwd: folder });
    },
    [create, show],
  );

  const openTypedFolder = useCallback(
    async (folder: string) => {
      const created = await gateway.createInFolder({ cwd: folder });
      if (created.ok) show(created.value.id);
      return created;
    },
    [gateway, show],
  );

  const rename = useCallback(
    async (id: string, title: string) =>
      report(await gateway.rename(id, title), "Could not rename it"),
    [gateway, report],
  );
  const stop = useCallback(
    async (id: string) => report(await gateway.stop(id), "Could not stop it"),
    [gateway, report],
  );
  const restart = useCallback(
    async (id: string) => report(await gateway.restart(id), "Could not run it again"),
    [gateway, report],
  );
  const remove = useCallback(
    async (id: string) => report(await gateway.remove(id), "Could not close it"),
    [gateway, report],
  );

  const dock: TerminalDock = layout.dock === "right" && wide ? "right" : "bottom";
  return useMemo(
    () => ({
      terminals,
      open: layout.open,
      activeId,
      dock,
      wide,
      size: dock === "right" ? layout.rightSize : layout.size,
      sidebarWidth: layout.sidebarWidth,
      sidebarCollapsed: layout.sidebarCollapsed,
      openIn,
      terminalForPort,
      picker,
      setPicker,
      openTypedFolder,
      rename,
      stop,
      restart,
      remove,
      show,
      create,
      setOpen: (open: boolean) => setLayout((current) => ({ ...current, open })),
      setDock: (next: TerminalDock) => setLayout((current) => ({ ...current, dock: next })),
      setSize: (size: number) =>
        setLayout((current) => {
          const value = Math.max(MIN_PANEL_SIZE, Math.round(size));
          return dock === "right" ? { ...current, rightSize: value } : { ...current, size: value };
        }),
      setSidebarWidth: (width: number) =>
        setLayout((current) => ({
          ...current,
          sidebarWidth: Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width))),
        })),
      setSidebarCollapsed: (collapsed: boolean) =>
        setLayout((current) => ({ ...current, sidebarCollapsed: collapsed })),
    }),
    [
      terminals,
      layout,
      activeId,
      dock,
      wide,
      openIn,
      terminalForPort,
      picker,
      openTypedFolder,
      rename,
      stop,
      restart,
      remove,
      show,
      create,
    ],
  );
}

/** The stored layout; a first visit in a wide window starts with the right pane. */
function readLayout(wide: boolean): Layout {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    if (stored === null) return { ...DEFAULT_LAYOUT, dock: wide ? "right" : "bottom" };
    const size = (value: unknown, fallback: number) =>
      typeof value === "number" && value >= MIN_PANEL_SIZE ? value : fallback;
    const sidebarWidth = stored.sidebarWidth;
    return {
      dock: stored.dock === "right" ? "right" : "bottom",
      size: size(stored.size, DEFAULT_LAYOUT.size),
      rightSize: size(stored.rightSize, DEFAULT_LAYOUT.rightSize),
      open: stored.open === true,
      sidebarWidth:
        typeof sidebarWidth === "number" &&
        sidebarWidth >= MIN_SIDEBAR_WIDTH &&
        sidebarWidth <= MAX_SIDEBAR_WIDTH
          ? sidebarWidth
          : DEFAULT_LAYOUT.sidebarWidth,
      sidebarCollapsed: stored.sidebarCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function storeLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private mode or a full storage: the panel just forgets its size.
  }
}
