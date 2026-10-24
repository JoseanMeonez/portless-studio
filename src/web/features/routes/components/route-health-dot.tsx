import type { Route } from "../../../../core/routes/route.ts";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";

/**
 * Green when the route's port answers, amber when it answers with a server error, red when an
 * app stops answering. An alias that never answers HTTP (a database, say) stays gray.
 */
export function RouteHealthDot({ route }: { route: Route }) {
  const isAlias = route.kind === "alias";
  const { health } = route;
  if (!health) return <StatusDot tone={isAlias ? "neutral" : "success"} />;
  if (health.state === "down") {
    return <StatusDot tone={isAlias ? "neutral" : "danger"} label="Not answering" />;
  }
  const label =
    health.status === undefined ? "Answering" : `${health.status} in ${health.latencyMs ?? 0} ms`;
  return <StatusDot tone={health.state === "up" ? "success" : "warning"} label={label} />;
}
