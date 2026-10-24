import type { Route } from "../../../../core/routes/route.ts";
import { formatUptime } from "../../../shared/lib/format-uptime.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { RouteHealthDot } from "./route-health-dot.tsx";
import styles from "./route-row.module.css";
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
    >
      <RouteHealthDot route={route} />

      <div className={styles.identity}>
        <span className={styles.nameLine}>
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
        </span>
        <span className={styles.url}>{route.url.replace(/^https?:\/\//, "")}</span>
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
          {route.listenerPid !== undefined ? (
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
