import type { Route } from "../../../../core/routes/route.ts";
import { formatUptime } from "../../../shared/lib/format-uptime.ts";
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
  onConfirm: () => void;
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
};

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
}: RouteRowProps) {
  const uptime = formatUptime(route.registeredAt, now);
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
      <RouteHealthDot route={route} />

      <div className={styles.identity}>
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

      <div className={styles.meta}>
        <div className={styles.tunnelCell}>
          <TunnelLinks tunnels={route.tunnels} />
        </div>
        <Badge tone={isAlias ? "accent" : "neutral"} className={styles.kind}>
          {isAlias ? "Alias" : "App"}
        </Badge>
        <span className={styles.port} title="Local port">
          :{route.port}
        </span>
        <span className={styles.uptime} title={isAlias ? "Named" : "Up for"}>
          {uptime ?? ""}
        </span>
      </div>

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
          <Button size="xs" variant="danger" onClick={onConfirm} autoFocus>
            {confirming === "remove" ? "Remove" : "Stop"}
          </Button>
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
    </li>
  );
}
