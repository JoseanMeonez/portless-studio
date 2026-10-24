import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./error-state.module.css";

type ErrorStateProps = {
  message: string;
  onRetry: () => void;
};

/** Shown when the first load failed, usually because the server stopped. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <section className={styles.error} role="alert">
      <span className={styles.icon}>
        <Icon name="warning" size={20} />
      </span>
      <h2 className={styles.title}>Can’t reach the studio server</h2>
      <p className={styles.text}>{message}</p>
      <p className={styles.text}>
        Start it again with <code className={styles.code}>portless-studio</code>, then retry.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <Icon name="refresh" size={14} />
        Retry
      </Button>
    </section>
  );
}
