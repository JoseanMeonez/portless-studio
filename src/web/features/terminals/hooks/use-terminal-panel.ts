import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError, CreateTerminalRequest } from "../../../../core/api/contract.ts";
import type { Result } from "../../../../core/result.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { useTerminalsGateway } from "./terminals-gateway-context.tsx";
import { useTerminals } from "./use-terminals.ts";

export type TerminalDock = "bottom" | "right";

/** The New terminal picker: closed, the list of folders, or the field for any folder. */
export type TerminalPickerState = "closed" | "folders" | "other";

type Layout = { dock: TerminalDock; size: number; open: boolean };

const LAYOUT_KEY = "portless-studio:terminal-panel";
export const MIN_PANEL_SIZE = 160;
const DEFAULT_LAYOUT: Layout = { dock: "bottom", size: 320, open: false };

/** The terminal panel: which terminal shows, where it docks and how big it is. */
export type TerminalPanelController = {
  terminals: TerminalInfo[];
  open: boolean;
  activeId: string | null;
  dock: TerminalDock;
  /** Height when docked at the bottom, width when docked on the right, in pixels. */
  size: number;
  /**
   * Shows a terminal for an item: the running one whose processes listen on `port`, else one in
   * this folder (a running one first), else a new shell there.
   */
  openIn(folder: string, port?: number): Promise<void>;
  picker: TerminalPickerState;
  setPicker(state: TerminalPickerState): void;
  /** Opens a shell in a folder typed by hand; the error comes back for the form to show. */
  openTypedFolder(folder: string): Promise<Result<TerminalInfo, ApiError>>;
  /** Renames a terminal; an empty title gives back the default one. */
  rename(id: string, title: string): Promise<void>;
  show(id: string): void;
  setOpen(open: boolean): void;
  setDock(dock: TerminalDock): void;
  setSize(size: number): void;
  /** Starts a terminal and shows it; null when Studio refused (a toast says why). */
  create(request: CreateTerminalRequest): Promise<TerminalInfo | null>;
};

export function useTerminalPanel(): TerminalPanelController {
  const gateway = useTerminalsGateway();
  const terminals = useTerminals();
  const toast = useToast();
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<TerminalPickerState>("closed");
  const latest = useRef(terminals);
  latest.current = terminals;

  useEffect(() => storeLayout(layout), [layout]);

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

  const create = useCallback(
    async (request: CreateTerminalRequest) => {
      const created = await gateway.create(request);
      if (!created.ok) {
        toast({
          title: "Could not open a terminal",
          description: created.error.message,
          tone: "error",
        });
        return null;
      }
      show(created.value.id);
      return created.value;
    },
    [gateway, toast, show],
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
    async (id: string, title: string) => {
      const renamed = await gateway.rename(id, title);
      if (!renamed.ok) {
        toast({ title: "Could not rename it", description: renamed.error.message, tone: "error" });
      }
    },
    [gateway, toast],
  );

  return useMemo(
    () => ({
      terminals,
      open: layout.open,
      activeId,
      dock: layout.dock,
      size: layout.size,
      openIn,
      picker,
      setPicker,
      openTypedFolder,
      rename,
      show,
      create,
      setOpen: (open: boolean) => setLayout((current) => ({ ...current, open })),
      setDock: (dock: TerminalDock) => setLayout((current) => ({ ...current, dock })),
      setSize: (size: number) =>
        setLayout((current) => ({ ...current, size: Math.max(MIN_PANEL_SIZE, Math.round(size)) })),
    }),
    [terminals, layout, activeId, openIn, picker, openTypedFolder, rename, show, create],
  );
}

function readLayout(): Layout {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return {
      dock: stored?.dock === "right" ? "right" : "bottom",
      size:
        typeof stored?.size === "number" && stored.size >= MIN_PANEL_SIZE
          ? stored.size
          : DEFAULT_LAYOUT.size,
      open: stored?.open === true,
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
