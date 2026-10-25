import { useId } from "react";
import styles from "./select-field.module.css";

type SelectFieldProps<T extends string> = {
  label: string;
  value: T;
  /** Value and label of each choice. */
  options: readonly (readonly [T, string])[];
  hint?: string;
  onChange: (value: T) => void;
};

/** A labelled dropdown for a setting with a few fixed choices. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  hint,
  onChange,
}: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const chosen = options.find(([option]) => option === event.target.value);
          if (chosen) onChange(chosen[0]);
        }}
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
