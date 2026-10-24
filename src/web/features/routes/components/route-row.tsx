import type { Route } from "../../../../core/routes/route.ts";
import { formatUptime } from "../../../shared/lib/format-uptime.ts";
import { Badge } from "../../../shared/ui/badge.tsx";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import styles from "./route-row.module.css";
import { TunnelLinks } from "./tunnel-links.tsx";

export type RouteRowProps = {
  route: Route;
  now: number;
  selected: boolean;
  /** The row asks "Remove this alias?" instead of showing its actions. */
  confirmingRemove: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onRename: () => void;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
};

export function RouteRow({
  route,
  now,
  selected,
  confirmingRemove,
  onSelect,
  onOpen,
  onCopy,
  onRename,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
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
      <StatusDot tone={isAlias ? "neutral" : "success"} />

      <div className={styles.identity}>
        <a href={route.url} target="_blank" rel="noreferrer" className={styles.name} tabIndex={-1}>
          {route.name}
        </a>
        <span className={styles.url}>{route.url.replace(/^https?:\/\//, "")}</span>
      </div>

      <div className={styles.meta}>
        <TunnelLinks tunnels={route.tunnels} />
        <Badge tone={isAlias ? "accent" : "neutral"}>{isAlias ? "Alias" : "App"}</Badge>
        <span className={styles.port} title="Local port">
          :{route.port}
        </span>
        <span className={styles.uptime} title={isAlias ? "Named" : "Up for"}>
          {uptime ?? ""}
        </span>
      </div>

      {confirmingRemove ? (
        <div className={styles.confirm}>
          <span className={styles.confirmText}>Remove {route.name}?</span>
          <Button size="xs" variant="ghost" onClick={onCancelRemove}>
            Cancel
          </Button>
          <Button size="xs" variant="danger" onClick={onConfirmRemove} autoFocus>
            Remove
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
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
