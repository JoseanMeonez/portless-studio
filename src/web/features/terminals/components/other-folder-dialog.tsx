import { type FormEvent, useState } from "react";
import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import styles from "./other-folder-dialog.module.css";

type OtherFolderDialogProps = {
  busy: boolean;
  /** Why Studio refused the last folder, such as one that does not exist. */
  error: string | null;
  onSubmit: (folder: string) => void;
  onClose: () => void;
};

/** Asks for any folder on this machine to open a shell in. */
export function OtherFolderDialog({ busy, error, onSubmit, onClose }: OtherFolderDialogProps) {
  const [folder, setFolder] = useState("");
  const trimmed = folder.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Dialog
      title="Open a shell in any folder"
      description="Studio starts your login shell there. Ports the commands you run open show up and get names like any other."
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={submit}>
        <TextField
          label="Folder"
          mono
          autoFocus
          placeholder="~/code/my-app"
          hint="An absolute path, or one that starts with ~ for your home folder."
          error={error}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        />
        <footer className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !trimmed}>
            Open shell
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
