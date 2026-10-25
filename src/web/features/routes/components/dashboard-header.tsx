import type { ReactNode } from "react";
import type { ProxyAction } from "../../../../core/api/contract.ts";
import type { DoctorStatus } from "../../../../core/doctor/doctor-check.ts";
import type { ProxyStatus } from "../../../../core/routes/route.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import type { ConnectionState } from "../data/routes-gateway.ts";
import { ConnectionIndicator } from "./connection-indicator.tsx";
import styles from "./dashboard-header.module.css";
import { ProxyMenu } from "./proxy-menu.tsx";

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
  /** Worst status of the health checks; null until they load. */
  health: DoctorStatus | null;
  /** Read by screen readers on the Health button, e.g. "Health: 1 warning". */
  healthLabel: string;
  onOpenHealth: () => void;
  proxyBusy: ProxyAction | null;
  onProxyAction: (action: ProxyAction) => void;
  /** The notifications bell, placed with the other actions. */
  notifications?: ReactNode;
};

const HEALTH_TONES = { ok: "success", warn: "warning", fail: "danger" } as const;

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
  health,
  healthLabel,
  onOpenHealth,
  proxyBusy,
  onProxyAction,
  notifications,
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
          {proxy ? (
            <ProxyMenu
              proxy={proxy}
              portlessVersion={portlessVersion}
              busy={proxyBusy}
              onAction={onProxyAction}
            />
          ) : null}
          <ConnectionIndicator state={connection} />
          {autoName ? (
            <span
              className={styles.autoMode}
              title="New dev servers get their suggested name automatically"
            >
              <Icon name="zap" size={12} />
              <span className={styles.autoModeLabel}>Auto mode on</span>
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
          {notifications}
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenHealth}
            aria-label={healthLabel}
            title="Health checks"
          >
            <StatusDot tone={health ? HEALTH_TONES[health] : "neutral"} />
            <span className={styles.healthLabel}>Health</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title="Toggle theme"
            className={styles.themeToggle}
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
