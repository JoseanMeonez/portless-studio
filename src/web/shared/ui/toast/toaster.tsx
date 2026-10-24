import { Icon } from "../icons/icon.tsx";
import type { Toast } from "./toast-context.ts";
import styles from "./toaster.module.css";

type ToasterProps = {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
};

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  return (
    <section aria-label="Notifications" aria-live="polite" className={styles.region}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
          {toast.tone === "success" ? <Icon name="check" className={styles.icon} /> : null}
          {toast.tone === "error" ? <Icon name="warning" className={styles.icon} /> : null}
          <div className={styles.body}>
            <p className={styles.title}>{toast.title}</p>
            {toast.description ? <p className={styles.description}>{toast.description}</p> : null}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}
