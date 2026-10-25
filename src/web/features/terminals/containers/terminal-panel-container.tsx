import { useCallback, useState } from "react";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  type TerminalAppearance,
} from "../../../../core/config/studio-config.ts";
import { plainText } from "../../../../core/terminals/terminal.ts";
import { copyText } from "../../../shared/lib/clipboard.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { NewTerminalForm, type TerminalFolder } from "../components/new-terminal-form.tsx";
import { TerminalPanel } from "../components/terminal-panel.tsx";
import { TerminalView } from "../components/terminal-view.tsx";
import { panelKey } from "../hooks/panel-keys.ts";
import { useTerminalsGateway } from "../hooks/terminals-gateway-context.tsx";
import { useNow } from "../hooks/use-now.ts";
import { useRecentCommands } from "../hooks/use-recent-commands.ts";
import type { TerminalPanelController } from "../hooks/use-terminal-panel.ts";
import { loadTerminalEngine, type TerminalEngine } from "../hooks/xterm-loader.ts";

type TerminalPanelContainerProps = {
  panel: TerminalPanelController;
  /** Project folders a new terminal can run in. */
  folders: readonly TerminalFolder[];
  /** Changes with the page theme, so the terminal colors follow. */
  themeKey: string;
  /** Font, cursor, scrollback and colors from the Studio config. */
  appearance?: TerminalAppearance;
  /** Replaced in tests, which cannot run xterm.js. */
  loadEngine?: () => Promise<TerminalEngine>;
  /** Opens a folder in the default editor; null when no editor was found. */
  editor?: { name: string; open: (folder: string) => void } | null;
};

/** xterm.js leaves these keys to the panel. */
const reservedKey = (event: KeyboardEvent) => event.type === "keydown" && panelKey(event) !== null;

/** The terminal panel wired to the gateway: list, controls, the live screen and new terminals. */
export function TerminalPanelContainer({
  panel,
  folders,
  themeKey,
  appearance = DEFAULT_TERMINAL_APPEARANCE,
  loadEngine = loadTerminalEngine,
  editor = null,
}: TerminalPanelContainerProps) {
  const gateway = useTerminalsGateway();
  const toast = useToast();
  const now = useNow();
  const [autoScroll, setAutoScroll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [focusTerminal, setFocusTerminal] = useState(false);
  const focused = useCallback(() => setFocusTerminal(false), []);
  // Until the terminal asked for shows up in the list, the newest one stands in.
  const active =
    panel.terminals.find((terminal) => terminal.id === panel.activeId) ??
    panel.terminals.at(-1) ??
    null;
  const activeId = active?.id ?? null;
  const recentCommands = useRecentCommands(panel.open && panel.terminals.length === 0);

  const connect = useCallback(
    (write: (text: string) => void) =>
      activeId === null
        ? () => {}
        : gateway.stream(activeId, 0, {
            onOutput: (chunk) => write(chunk.data),
            onStatus: () => {},
          }),
    [gateway, activeId],
  );
  const send = useCallback(
    (text: string) => {
      if (activeId !== null) void gateway.input(activeId, text);
    },
    [gateway, activeId],
  );

  if (!panel.open) return null;
  // With no terminal yet, the panel itself offers to start one.
  const showForm = panel.terminals.length === 0;

  const copyUrl = (url: string) => {
    void copyText(url).then((copied) =>
      toast(
        copied
          ? { title: "Copied the URL", description: url, tone: "success" }
          : { title: "The browser blocked copying", tone: "error" },
      ),
    );
  };

  return (
    <TerminalPanel
      terminals={panel.terminals}
      active={showForm ? null : active}
      dock={panel.dock}
      canDockRight={panel.wide}
      fullScreen={panel.fullScreen}
      narrow={panel.narrow}
      size={panel.size}
      sizeLimits={panel.sizeLimits}
      sidebarWidth={panel.sidebarWidth}
      sidebarLimits={panel.sidebarLimits}
      sidebarCollapsed={panel.sidebarCollapsed}
      sidebarFits={panel.sidebarFits}
      autoScroll={autoScroll}
      now={now}
      actions={{
        onSelect: panel.show,
        onRename: (id, title) => void panel.rename(id, title),
        onStop: (id) => void panel.stop(id),
        onRestart: (id) => void panel.restart(id),
        onClose: (id) => void panel.remove(id),
        onCopyUrl: copyUrl,
        editor,
      }}
      onEnterTerminal={(id) => {
        panel.show(id);
        setFocusTerminal(true);
      }}
      onNew={() => panel.setPicker("folders")}
      onRunAllAgain={() => {
        for (const terminal of panel.terminals) {
          if (terminal.stoppedByRestart) void panel.restart(terminal.id);
        }
      }}
      onToggleAutoScroll={() => setAutoScroll((value) => !value)}
      onCopyOutput={() => {
        if (!activeId) return;
        void gateway.output(activeId).then(async (result) => {
          if (!result.ok) {
            toast({
              title: "Could not read the output",
              description: result.error.message,
              tone: "error",
            });
            return;
          }
          const copied = await copyText(plainText(result.value));
          toast(
            copied
              ? { title: "Copied the output", tone: "success" }
              : { title: "The browser blocked copying", tone: "error" },
          );
        });
      }}
      onToggleDock={() => panel.setDock(panel.dock === "bottom" ? "right" : "bottom")}
      onToggleFullScreen={() => panel.setFullScreen(!panel.fullScreen)}
      onResize={panel.setSize}
      onResetSize={panel.resetSize}
      onResizeSidebar={panel.setSidebarWidth}
      onResetSidebarWidth={panel.resetSidebarWidth}
      onToggleSidebar={() => panel.setSidebarCollapsed(!panel.sidebarCollapsed)}
      onClose={() => panel.setOpen(false)}
    >
      {showForm ? (
        <NewTerminalForm
          folders={folders}
          initialPath={active?.cwd}
          busy={busy}
          recentCommands={recentCommands}
          onCancel={() => panel.setOpen(false)}
          onSubmit={({ cwd, command }) => {
            setBusy(true);
            void panel
              .create({ cwd, ...(command.trim() ? { command } : {}) })
              .then(() => setBusy(false));
          }}
        />
      ) : active ? (
        <TerminalView
          key={active.id}
          convertEol={active.mode === "pipes"}
          autoScroll={autoScroll}
          appearance={appearance}
          themeKey={themeKey}
          loadEngine={loadEngine}
          connect={connect}
          onInput={send}
          reservedKey={reservedKey}
          focusOnReady={focusTerminal}
          onFocused={focused}
        />
      ) : null}
    </TerminalPanel>
  );
}
