import type { Tunnel, TunnelProvider } from "../../../../core/routes/route.ts";
import styles from "./tunnel-links.module.css";

const PROVIDER_NAMES: Record<TunnelProvider, string> = {
  tailscale: "Tailscale",
  ngrok: "ngrok",
  cloudflare: "Cloudflare",
};

/** Public URLs of the route, one small link per tunnel provider. */
export function TunnelLinks({ tunnels }: { tunnels: readonly Tunnel[] }) {
  if (tunnels.length === 0) return null;
  return (
    <span className={styles.tunnels}>
      {tunnels.map((tunnel) => (
        <a
          key={tunnel.provider}
          href={tunnel.url}
          target="_blank"
          rel="noreferrer"
          className={styles.tunnel}
          title={tunnel.url}
          aria-label={`${PROVIDER_NAMES[tunnel.provider]} tunnel: ${tunnel.url}`}
        >
          {PROVIDER_NAMES[tunnel.provider]}
        </a>
      ))}
    </span>
  );
}
