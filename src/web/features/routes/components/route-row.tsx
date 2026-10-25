import type { Route } from "../../../../core/routes/route.ts";
import { routeUptime } from "../../../shared/lib/uptime-label.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import { DirectUrl } from "./direct-url.tsx";
import { ProjectLocation } from "./project-location.tsx";
import { RouteHealthDot } from "./route-health-dot.tsx";
import styles from "./route-row.module.css";
import { type MenuPoint, rowMenuTrigger } from "./row-menu-trigger.ts";
import type { RowTerminal } from "./row-terminal.ts";
import { RowTerminalActions } from "./row-terminal-actions.tsx";
import { RowTerminalStatus } from "./row-terminal-status.tsx";
import { TunnelLinks } from "./tunnel-links.tsx";

export type RouteRowProps = {
  route: Route;
  now: number;
  selected: boolean;
  /** Pinned above every group. */
  favorite: boolean;
  /** The row asks "Remove this alias?" or "Stop this server?" instead of showing its actions. */
  confirming: RowConfirmation | null;
  onSelect: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onRename: () => void;
  onRequestRemove: () => void;
  /** Shown only when the route's port has a known pid. */
  onRequestStop: () => void;
  onConfirm: (all?: boolean) => void;
  onCancelConfirm: () => void;
  onToggleFavorite: () => void;
  onMoveToGroup: () => void;
  /** Right-click or Ctrl+click: the menu with open with, copy path and more. */
  onMenu: (point: MenuPoint) => void;
  onCopyDirectUrl: () => void;
  /** Shows the terminal of the route's folder, or opens a shell there; hidden without it. */
  onOpenTerminal?: (() => void) | undefined;
  /** The Studio terminal serving the route's port: a status chip and its actions. */
  terminal?: RowTerminal | null | undefined;
  /** Opens the route's folder in the default editor; hidden without a folder or an editor. */
  editor?: RowEditor | null | undefined;
};

/** The default editor from Settings and how to open the row's folder in it. */
export type RowEditor = { name: string; onOpen: () => void };

export type RowConfirmation = "remove" | "stop";

export function RouteRow({
  route,
  now,
  selected,
  favorite,
  confirming,
  onSelect,
  onOpen,
  onCopy,
  onRename,
  onRequestRemove,
  onRequestStop,
  onConfirm,
  onCancelConfirm,
  onToggleFavorite,
  onMoveToGroup,
  onMenu,
  onCopyDirectUrl,
  onOpenTerminal,
  terminal,
  editor,
}: RouteRowProps) {
  const uptime = routeUptime(route, now);
  const isAlias = route.kind === "alias";

  return (
    <li
      className={styles.row}
      aria-current={selected ? "true" : undefined}
      data-selected={selected || undefined}
      onPointerDown={onSelect}
      onFocus={onSelect}
      {...rowMenuTrigger(onMenu)}
    >
      <span className={styles.status} data-cell="status">
        <RouteHealthDot route={route} />
      </span>

      <div className={styles.identity} data-cell="identity">
        <span className={styles.nameLine}>
          <ItemIcon icon={route.icon} name={route.project?.name ?? route.name} />
          <a
            href={route.url}
            target="_blank"
            rel="noreferrer"
            className={styles.name}
            tabIndex={-1}
          >
            {route.name}
          </a>
          {favorite ? (
            <span className={styles.favoriteMark} role="img" aria-label="Favorite" title="Favorite">
              <Icon name="star" size={12} />
            </span>
          ) : null}
          {terminal ? <RowTerminalStatus terminal={terminal} label={route.name} /> : null}
        </span>
        <span className={styles.url}>{route.url.replace(/^https?:\/\//, "")}</span>
        <DirectUrl port={route.port} onCopy={onCopyDirectUrl} />
        <ProjectLocation project={route.project} />
      </div>

      <div className={styles.meta} data-cell="meta">
        <div className={styles.tunnelCell} data-cell="tunnels">
          <TunnelLinks tunnels={route.tunnels} />
        </div>
        <span className={styles.kind} data-cell="kind">
          <Badge tone={isAlias ? "accent" : "neutral"}>{isAlias ? "Alias" : "App"}</Badge>
        </span>
        <span className={styles.port} data-cell="port" title="Local port">
          :{route.port}
        </span>
        <span
          className={styles.uptime}
          data-cell="uptime"
          data-state={uptime.state}
          title={uptime.title || undefined}
        >
          {uptime.text}
        </span>
      </div>

      {/* Fixed width on every row, so the columns before it line up; wider actions overlay. */}
      <div className={styles.actionsCell} data-cell="actions">
        {confirming ? (
          <div className={styles.confirm}>
            <span className={styles.confirmText}>
              {confirming === "remove"
                ? `Remove ${route.name}?`
                : `Stop :${route.port} (pid ${route.listenerPid})?`}
            </span>
            <Button size="xs" variant="ghost" onClick={onCancelConfirm}>
              Cancel
            </Button>
            <Button size="xs" variant="danger" onClick={() => onConfirm()} autoFocus>
              {confirming === "remove" ? "Remove" : "Stop"}
            </Button>
            {confirming === "stop" ? (
              <Button
                size="xs"
                variant="danger"
                title="Stop the whole development command and its child processes"
                onClick={() => onConfirm(true)}
              >
                Stop all
              </Button>
            ) : null}
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={favorite ? `Unpin ${route.name}` : `Pin ${route.name} to favorites`}
              aria-pressed={favorite}
              title={favorite ? "Unpin (F)" : "Pin to favorites (F)"}
              onClick={onToggleFavorite}
            >
              <Icon name="star" size={14} className={favorite ? styles.starOn : undefined} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Move ${route.name} to a group`}
              title="Move to group…"
              onClick={onMoveToGroup}
            >
              <Icon name="folder" size={14} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Open ${route.name}`}
              title="Open (Enter)"
              onClick={onOpen}
            >
              <Icon name="arrowUpRight" size={14} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Copy URL of ${route.name}`}
              title="Copy URL (C)"
              onClick={onCopy}
            >
              <Icon name="copy" size={14} />
            </Button>
            {editor && route.project?.path ? (
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label={`Open ${route.name} in ${editor.name}`}
                title={`Open in ${editor.name}`}
                onClick={editor.onOpen}
              >
                <Icon name="code" size={14} />
              </Button>
            ) : null}
            {terminal ? (
              <RowTerminalActions terminal={terminal} label={route.name} />
            ) : onOpenTerminal ? (
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label={`Open a terminal for ${route.name}`}
                title="Terminal (T)"
                onClick={onOpenTerminal}
              >
                <Icon name="terminal" size={14} />
              </Button>
            ) : null}
            {route.listenerPid !== undefined && !terminal?.running ? (
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label={`Stop the server of ${route.name}`}
                title={`Stop the server (pid ${route.listenerPid})`}
                onClick={onRequestStop}
              >
                <Icon name="power" size={14} />
              </Button>
            ) : null}
            {isAlias ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  iconOnly
                  aria-label={`Rename ${route.name}`}
                  title="Rename (R)"
                  onClick={onRename}
                >
                  <Icon name="pencil" size={14} />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove ${route.name}`}
                  title="Remove (Delete)"
                  onClick={onRequestRemove}
                >
                  <Icon name="trash" size={14} />
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}
