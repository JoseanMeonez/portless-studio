import type { KeyboardEvent } from "react";
import type { CustomApp } from "../../../../core/projects/custom-app.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./custom-apps-field.module.css";

type CustomAppsFieldProps = {
  /** Null while loading. */
  apps: readonly CustomApp[] | null;
  error: string | null;
  status: "idle" | "saving" | "saved";
  onChange: (index: number, field: keyof CustomApp, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSave: () => void;
};

/**
 * Apps for the open-with menu: a name and a command per row. They live in their own file, so
 * they are saved with their own button rather than with the rest of the settings.
 */
export function CustomAppsField({
  apps,
  error,
  status,
  onChange,
  onAdd,
  onRemove,
  onSave,
}: CustomAppsFieldProps) {
  if (apps === null) return <p className={styles.hint}>Loading apps…</p>;
  // Enter saves these rows instead of submitting the settings form around them.
  const saveOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSave();
  };
  return (
    <div className={styles.field}>
      <p className={styles.hint}>
        Write <code>{"{path}"}</code> where the folder goes, like{" "}
        <code>{"kitty --directory {path} nvim"}</code>. Without it the folder goes last. Studio runs
        the command directly, not through a shell.
      </p>
      {apps.length > 0 ? (
        <ul className={styles.list}>
          {apps.map((app, index) => {
            const position = index + 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved, and their order is the id.
              <li key={index} className={styles.row}>
                <input
                  className={styles.input}
                  aria-label={`Name of app ${position}`}
                  placeholder="Name"
                  value={app.name}
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={saveOnEnter}
                  onChange={(event) => onChange(index, "name", event.target.value)}
                />
                <input
                  className={`${styles.input} ${styles.mono}`}
                  aria-label={`Command of app ${position}`}
                  placeholder="editor {path}"
                  value={app.command}
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={saveOnEnter}
                  onChange={(event) => onChange(index, "command", event.target.value)}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove app ${position}`}
                  title="Remove"
                  onClick={() => onRemove(index)}
                >
                  <Icon name="x" size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button size="xs" variant="ghost" onClick={onAdd}>
          <Icon name="plus" size={14} />
          Add an app
        </Button>
        <Button size="xs" variant="secondary" disabled={status === "saving"} onClick={onSave}>
          {status === "saving" ? "Saving…" : "Save apps"}
        </Button>
        {status === "saved" ? (
          <span className={styles.saved} role="status">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
