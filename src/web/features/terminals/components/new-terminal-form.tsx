import { type FormEvent, useId, useState } from "react";
import { Button } from "../../../shared/ui/button.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import styles from "./new-terminal-form.module.css";

/** A folder a new terminal can run in. */
export type TerminalFolder = { label: string; path: string };

type NewTerminalFormProps = {
  folders: readonly TerminalFolder[];
  initialPath?: string | undefined;
  busy: boolean;
  onSubmit: (request: { cwd: string; command: string }) => void;
  onCancel: () => void;
};

/** Picks a project folder and a command; an empty command opens a shell. */
export function NewTerminalForm({
  folders,
  initialPath,
  busy,
  onSubmit,
  onCancel,
}: NewTerminalFormProps) {
  const [path, setPath] = useState(initialPath ?? folders[0]?.path ?? "");
  const [command, setCommand] = useState("");
  const selectId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (path) onSubmit({ cwd: path, command });
  };

  if (folders.length === 0) {
    return (
      <div className={styles.form}>
        <p className={styles.empty}>
          No project folders yet. Terminals open in the folder of a route or detected port, or start
          one from your shell with <code>portless-studio run -- pnpm dev</code>.
        </p>
        <div className={styles.buttons}>
          <Button size="sm" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={submit} aria-label="New terminal">
      <div className={styles.field}>
        <label htmlFor={selectId} className={styles.label}>
          Project folder
        </label>
        <select
          id={selectId}
          className={styles.select}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        >
          {folders.map((folder) => (
            <option key={folder.path} value={folder.path}>
              {folder.label} ({folder.path})
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="Command"
        mono
        placeholder="pnpm dev"
        hint="Leave empty for a shell."
        value={command}
        onChange={(event) => setCommand(event.target.value)}
      />
      <div className={styles.buttons}>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={busy || !path}>
          {command.trim() ? "Run" : "Open shell"}
        </Button>
      </div>
    </form>
  );
}
