import type { ProxyStatus } from "../../../../core/routes/route.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import type { ConnectionState } from "../data/routes-gateway.ts";
import { ConnectionIndicator } from "./connection-indicator.tsx";
import styles from "./dashboard-header.module.css";
import { ProxyStatusPill } from "./proxy-status-pill.tsx";

type DashboardHeaderProps = {
  proxy: ProxyStatus | null;
  /** Shown in the proxy pill's tooltip; null when unknown or not installed. */
  portlessVersion: string | null;
  connection: ConnectionState;
  /** Auto mode names new dev servers by itself; the header says so while it is on. */
  autoName: boolean;
  theme: "light" | "dark";
  modifierLabel: string;
  onToggleTheme: () => void;
  onOpenCommandMenu: () => void;
  onNamePort: () => void;
  onOpenSettings: () => void;
};

export function DashboardHeader({
  proxy,
  portlessVersion,
  connection,
  autoName,
  theme,
  modifierLabel,
  onToggleTheme,
  onOpenCommandMenu,
  onNamePort,
  onOpenSettings,
}: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
            <path
              d="M8 16V8h4.5a2.5 2.5 0 0 1 0 5H8"
              stroke="var(--color-bg)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1 className={styles.title}>
            portless <span className={styles.titleMuted}>studio</span>
          </h1>
        </div>

        <div className={styles.status}>
          {proxy ? <ProxyStatusPill proxy={proxy} portlessVersion={portlessVersion} /> : null}
          <ConnectionIndicator state={connection} />
          {autoName ? (
            <span
              className={styles.autoMode}
              title="New dev servers get their suggested name automatically"
            >
              <Icon name="zap" size={12} />
              Auto mode on
            </span>
          ) : null}
        </div>

        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCommandMenu}
            aria-label="Open command menu"
            className={styles.commandButton}
          >
            <Kbd>{modifierLabel}</Kbd>
            <Kbd>K</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title="Toggle theme"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings (,)"
          >
            <Icon name="settings" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onNamePort}
            title="Name a port (N)"
            aria-label="Name a port"
          >
            <Icon name="plus" size={14} />
            <span className={styles.namePortLabel}>Name a port</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
