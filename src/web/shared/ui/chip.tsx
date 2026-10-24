import styles from "./chip.module.css";
import { Icon } from "./icons/icon.tsx";

type ChipProps = {
  label: string;
  onRemove: () => void;
  mono?: boolean;
};

/** One value in a list the person edits, with a button that removes it. */
export function Chip({ label, onRemove, mono = false }: ChipProps) {
  return (
    <span className={[styles.chip, mono ? styles.mono : ""].filter(Boolean).join(" ")}>
      <span className={styles.label} title={label}>
        {label}
      </span>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
