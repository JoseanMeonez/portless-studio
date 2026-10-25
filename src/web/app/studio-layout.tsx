import type { CSSProperties } from "react";
import { RoutesDashboard, type TerminalLauncher } from "../features/routes/index.ts";
import {
  type TerminalEngine,
  TerminalPanelContainer,
  TerminalPickerContainer,
  useTerminalPanel,
} from "../features/terminals/index.ts";
import styles from "./studio-layout.module.css";

type StudioLayoutProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  loadTerminalEngine?: (() => Promise<TerminalEngine>) | undefined;
};

/**
 * Joins the routes dashboard and the terminal panel: rows open terminals, focus requests show
 * them, and the page leaves room for the docked panel.
 */
export function StudioLayout({ theme, onToggleTheme, loadTerminalEngine }: StudioLayoutProps) {
  const panel = useTerminalPanel();
  const launcher: TerminalLauncher = {
    openIn: (folder, port) => void panel.openIn(folder, port),
    show: panel.show,
    pick: () => panel.setPicker("folders"),
  };
  // Room for the docked panel, so it never covers the last rows.
  const room = panel.open ? `${panel.size}px` : "0px";
  const style = {
    "--terminal-room-bottom": panel.dock === "bottom" ? room : "0px",
    "--terminal-room-right": panel.dock === "right" ? room : "0px",
  } as CSSProperties;
  return (
    <div className={styles.layout} style={style}>
      <RoutesDashboard
        theme={theme}
        onToggleTheme={onToggleTheme}
        terminals={launcher}
        terminalPanel={(folders) => (
          <>
            <TerminalPanelContainer
              panel={panel}
              folders={folders}
              themeKey={theme}
              {...(loadTerminalEngine ? { loadEngine: loadTerminalEngine } : {})}
            />
            <TerminalPickerContainer panel={panel} folders={folders} />
            {panel.open ? null : (
              <button
                type="button"
                className={styles.toggle}
                onClick={() => panel.setOpen(true)}
                aria-label={`Show terminals (${panel.terminals.length})`}
              >
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
