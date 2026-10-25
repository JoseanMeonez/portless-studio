import styles from "./terminal-title-field.module.css";

type TerminalTitleFieldProps = {
  title: string;
  /** null leaves the title as it was. */
  onDone: (title: string | null) => void;
};

/** Renames a terminal in place: Enter or a click away keeps what was typed, Escape drops it. */
export function TerminalTitleField({ title, onDone }: TerminalTitleFieldProps) {
  return (
    <input
      className={styles.field}
      aria-label={`Rename ${title}`}
      defaultValue={title}
      maxLength={60}
      // biome-ignore lint/a11y/noAutofocus: the field appears because the person asked to rename.
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onDone(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.stopPropagation();
          onDone(null);
        }
      }}
      onBlur={(event) => {
        const value = event.currentTarget.value;
        onDone(value === title ? null : value);
      }}
    />
  );
}
