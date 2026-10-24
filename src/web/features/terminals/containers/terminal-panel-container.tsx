import { useCallback, useState } from "react";
import { plainText } from "../../../../core/terminals/terminal.ts";
import { copyText } from "../../../shared/lib/clipboard.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { NewTerminalForm, type TerminalFolder } from "../components/new-terminal-form.tsx";
import { TerminalPanel } from "../components/terminal-panel.tsx";
import { TerminalView } from "../components/terminal-view.tsx";
import { useTerminalsGateway } from "../hooks/terminals-gateway-context.tsx";
import type { TerminalPanelController } from "../hooks/use-terminal-panel.ts";
import { loadTerminalEngine, type TerminalEngine } from "../hooks/xterm-loader.ts";

type TerminalPanelContainerProps = {
  panel: TerminalPanelController;
  /** Project folders a new terminal can run in. */
  folders: readonly TerminalFolder[];
  /** Changes with the page theme, so the terminal colors follow. */
  themeKey: string;
  /** Replaced in tests, which cannot run xterm.js. */
  loadEngine?: () => Promise<TerminalEngine>;
};

/** The terminal panel wired to the gateway: tabs, controls, the live screen and new terminals. */
export function TerminalPanelContainer({
  panel,
  folders,
  themeKey,
  loadEngine = loadTerminalEngine,
}: TerminalPanelContainerProps) {
  const gateway = useTerminalsGateway();
  const toast = useToast();
  const [follow, setFollow] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  // Until the terminal asked for shows up in the list, the newest one stands in.
  const active =
    panel.terminals.find((terminal) => terminal.id === panel.activeId) ??
    panel.terminals.at(-1) ??
    null;
  const activeId = active?.id ?? null;

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
  const report = (result: { ok: boolean; error?: { message: string } }, failed: string) => {
    if (!result.ok)
      toast({ title: failed, description: result.error?.message ?? "", tone: "error" });
  };
  const showForm = creating || panel.terminals.length === 0;

  return (
    <TerminalPanel
      terminals={panel.terminals}
      active={showForm ? null : active}
      dock={panel.dock}
      size={panel.size}
      follow={follow}
      onSelect={(id) => {
        setCreating(false);
        panel.show(id);
      }}
      onCloseTerminal={(id) =>
        void gateway.remove(id).then((result) => report(result, "Could not close it"))
      }
      onNew={() => setCreating(true)}
      onStop={() => {
        if (activeId)
          void gateway.stop(activeId).then((result) => report(result, "Could not stop it"));
      }}
      onRestart={() => {
        if (activeId) {
          void gateway.restart(activeId).then((result) => report(result, "Could not restart it"));
        }
      }}
      onToggleFollow={() => setFollow((value) => !value)}
      onCopy={() => {
        if (!activeId) return;
        void gateway.output(activeId).then(async (result) => {
          if (!result.ok) return report(result, "Could not read the output");
          const copied = await copyText(plainText(result.value));
          toast(
            copied
              ? { title: "Copied the output", tone: "success" }
              : { title: "The browser blocked copying", tone: "error" },
          );
        });
      }}
      onToggleDock={() => panel.setDock(panel.dock === "bottom" ? "right" : "bottom")}
      onResize={panel.setSize}
      onClose={() => panel.setOpen(false)}
    >
      {showForm ? (
        <NewTerminalForm
          folders={folders}
          initialPath={active?.cwd}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            if (panel.terminals.length === 0) panel.setOpen(false);
          }}
          onSubmit={({ cwd, command }) => {
            setBusy(true);
            void panel.create({ cwd, ...(command.trim() ? { command } : {}) }).then((created) => {
              setBusy(false);
              if (created) setCreating(false);
            });
          }}
        />
      ) : active ? (
        <TerminalView
          key={active.id}
          convertEol={active.mode === "pipes"}
          follow={follow}
          themeKey={themeKey}
          loadEngine={loadEngine}
          connect={connect}
          onInput={send}
        />
      ) : null}
    </TerminalPanel>
  );
}
