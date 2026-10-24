import { type FormEvent, useState } from "react";
import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import styles from "./name-dialog.module.css";

type NameDialogProps = {
  title: string;
  description?: string;
  label: string;
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

/** Asks for one name: a new view, a renamed view or a renamed group. */
export function NameDialog({
  title,
  description,
  label,
  initialName = "",
  submitLabel,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Dialog title={title} onClose={onClose} {...(description ? { description } : {})}>
      <form className={styles.form} onSubmit={submit}>
        <TextField
          label={label}
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <footer className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!trimmed}>
            {submitLabel}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
