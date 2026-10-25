import type { CSSProperties } from "react";
import { RoutesDashboard, type TerminalLauncher } from "../features/routes/index.ts";
import {
  type TerminalEngine,
  TerminalPanelContainer,
  TerminalPickerContainer,
  useTerminalPanel,
} from "../features/terminals/index.ts";
import styles from "./studio-layout.module.css";
import { useTerminalAppearance } from "./use-terminal-appearance.ts";

type StudioLayoutProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  loadTerminalEngine?: (() => Promise<TerminalEngine>) | undefined;
};

/**
 * Joins the routes dashboard and the terminal panel: rows show and drive their terminals, focus
 * requests show them, and the page leaves room for the panel, at the bottom or as a right pane.
 */
export function StudioLayout({ theme, onToggleTheme, loadTerminalEngine }: StudioLayoutProps) {
  const panel = useTerminalPanel();
  const { appearance, onConfigSaved } = useTerminalAppearance();
  const launcher: TerminalLauncher = {
    openIn: (folder, port) => void panel.openIn(folder, port),
    show: panel.show,
    pick: () => panel.setPicker("folders"),
    terminalForPort: panel.terminalForPort,
    stop: (id) => void panel.stop(id),
    restart: (id) => void panel.restart(id),
    followSelection: (port) => {
      if (panel.dock !== "right" || !panel.open) return;
      const terminal = panel.terminalForPort(port);
      if (terminal) panel.show(terminal.id);
    },
    toggleList: () => {
      panel.setSidebarCollapsed(!panel.sidebarCollapsed);
      panel.setOpen(true);
    },
    fullScreen: {
      label: panel.fullScreen ? "Exit full screen terminal" : "Full screen terminal",
      toggle: () => panel.setFullScreen(!panel.fullScreen),
    },
    ...(panel.wide
      ? {
          dock: {
            label: panel.dock === "right" ? "Terminal at the bottom" : "Terminal on the right",
            toggle: () => {
              panel.setDock(panel.dock === "right" ? "bottom" : "right");
              panel.setOpen(true);
            },
          },
        }
      : {}),
  };
  // Room for the panel, so it never covers the last rows; on the right it sits next to the list.
  // Full screen covers the page, which keeps its own layout underneath.
  const room = panel.open && !panel.fullScreen ? `${panel.size}px` : "0px";
  const style = {
    "--terminal-room-bottom": panel.dock === "bottom" ? room : "0px",
    "--terminal-room-right": panel.dock === "right" ? room : "0px",
  } as CSSProperties;
  const waiting = panel.terminals.filter((terminal) => terminal.stoppedByRestart).length;
  return (
    <div className={styles.layout} style={style}>
      <RoutesDashboard
        theme={theme}
        onToggleTheme={onToggleTheme}
        terminals={launcher}
        onConfigSaved={onConfigSaved}
        terminalPanel={(folders, editor) => (
          <>
            <TerminalPanelContainer
              panel={panel}
              folders={folders}
              themeKey={theme}
              appearance={appearance}
              editor={editor}
              {...(loadTerminalEngine ? { loadEngine: loadTerminalEngine } : {})}
            />
            <TerminalPickerContainer panel={panel} folders={folders} />
            {panel.open ? null : (
              <button
                type="button"
                className={styles.toggle}
                onClick={() => panel.setOpen(true)}
                aria-label={`Show terminals (${panel.terminals.length}${waiting > 0 ? `, ${waiting} stopped by a Studio restart` : ""})`}
              >
                {waiting > 0 ? <span className={styles.waiting} aria-hidden="true" /> : null}
                Terminals
                {panel.terminals.length > 0 ? (
                  <span className={styles.count}>{panel.terminals.length}</span>
                ) : null}
              </button>
            )}
          </>
        )}
      />
    </div>
  );
}
