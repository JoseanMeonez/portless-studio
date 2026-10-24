import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./proxy-banner.module.css";

/** Warns that routes exist but nothing answers them until the proxy starts. */
export function ProxyBanner() {
  return (
    <div className={styles.banner} role="status">
      <Icon name="warning" className={styles.icon} />
      <p>
        <strong className={styles.strong}>The portless proxy is not running.</strong> These names
        will not open until you start it with{" "}
        <code className={styles.code}>portless proxy start</code>.
      </p>
    </div>
  );
}
