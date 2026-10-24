import type { ProxyStatus } from "../../../../core/routes/route.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { StatusDot } from "../../../shared/ui/status-dot.tsx";
import styles from "./proxy-status-pill.module.css";

/** Whether the portless proxy is up, and how it serves: protocol, port and TLD. */
export function ProxyStatusPill({ proxy }: { proxy: ProxyStatus }) {
  const tld = proxy.tlds[0];
  return (
    <div className={styles.pill} title="portless proxy">
      <StatusDot tone={proxy.running ? "success" : "danger"} />
      <span className={styles.state}>{proxy.running ? "Running" : "Stopped"}</span>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.detail}>
        <Icon name={proxy.https ? "lock" : "globe"} size={12} />
        {proxy.https ? "HTTPS" : "HTTP"}
      </span>
      {proxy.port !== null ? <span className={styles.mono}>:{proxy.port}</span> : null}
      {tld ? <span className={styles.mono}>.{tld}</span> : null}
    </div>
  );
}
