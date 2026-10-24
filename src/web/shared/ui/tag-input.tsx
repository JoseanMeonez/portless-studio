import { type ReactNode, useId, useState } from "react";
import { Chip } from "./chip.tsx";
import styles from "./tag-input.module.css";

type TagInputProps = {
  label: string;
  values: readonly string[];
  /** Adds what the person typed; returns why it was refused, or null when it was added. */
  onAdd: (value: string) => string | null;
  onRemove: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  /** An error from outside the field, such as the server rejecting the list. */
  error?: string | null;
  mono?: boolean;
  inputMode?: "text" | "numeric";
};

/** A list of short values shown as chips, with a field that adds one on Enter or comma. */
export function TagInput({
  label,
  values,
  onAdd,
  onRemove,
  placeholder,
  hint,
  error,
  mono = false,
  inputMode = "text",
}: TagInputProps) {
  const id = useId();
  const messageId = useId();
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const shownError = addError ?? error ?? null;
  const message = shownError ?? hint;

  const add = () => {
    const value = draft.trim();
    if (value === "") return;
    const refused = onAdd(value);
    setAddError(refused);
    if (refused === null) setDraft("");
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.box} data-invalid={shownError ? true : undefined}>
        {values.length > 0 ? (
          <ul className={styles.chips} aria-label={label}>
            {values.map((value) => (
              <li key={value} className={styles.item}>
                <Chip label={value} mono={mono} onRemove={() => onRemove(value)} />
              </li>
            ))}
          </ul>
        ) : null}
        <input
          id={id}
          className={[styles.input, mono ? styles.mono : ""].filter(Boolean).join(" ")}
          value={draft}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setAddError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
              onRemove(values[values.length - 1] as string);
            }
          }}
          onBlur={add}
        />
      </div>
      {message ? (
        <p
          id={messageId}
          className={shownError ? styles.error : styles.hint}
          role={shownError ? "alert" : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
