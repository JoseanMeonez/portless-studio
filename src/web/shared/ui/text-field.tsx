import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from "react";
import styles from "./text-field.module.css";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** Shown under the field when there is no error. */
  hint?: ReactNode;
  error?: string | null;
  /** Monospace text, for ports, names and URLs. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({
  label,
  hint,
  error,
  mono = false,
  className,
  ref,
  ...input
}: TextFieldProps) {
  const id = useId();
  const messageId = useId();
  const message = error ?? hint;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className={[styles.input, mono ? styles.mono : ""].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        autoComplete="off"
        spellCheck={false}
        {...input}
      />
      {message ? (
        <p
          id={messageId}
          className={error ? styles.error : styles.hint}
          role={error ? "alert" : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
