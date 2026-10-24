import { type ReactNode, useId } from "react";
import styles from "./switch.module.css";

type SwitchProps = {
  label: string;
  /** A line under the label that says what turning it on does. */
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string | undefined;
};

/** An on/off setting that applies right away or on save, announced as a switch. */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className,
}: SwitchProps) {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <span className={styles.text}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        className={styles.track}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  );
}
