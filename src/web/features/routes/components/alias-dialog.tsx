import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import type { AliasForm } from "../hooks/use-alias-form.ts";
import styles from "./alias-dialog.module.css";

type AliasDialogProps = {
  mode: "create" | "rename";
  /** Current name, when renaming. */
  currentName?: string;
  form: AliasForm;
  onClose: () => void;
};

/** The "Name a port" form, also used to rename an alias (then only the name can change). */
export function AliasDialog({ mode, currentName, form, onClose }: AliasDialogProps) {
  const creating = mode === "create";
  return (
    <Dialog
      title={creating ? "Name a port" : `Rename ${currentName ?? "alias"}`}
      description={
        creating
          ? "Give a running port a name you can open in the browser instead of a number."
          : "The port stays the same; only its name changes."
      }
      onClose={onClose}
    >
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (form.canSubmit) void form.submit();
        }}
      >
        <div className={styles.fields}>
          <TextField
            label="Name"
            mono
            placeholder="db"
            value={form.name}
            error={form.nameError}
            hint="Letters, numbers and hyphens. Use dots for parts, like api.myapp."
            autoFocus
            onChange={(event) => form.setName(event.target.value)}
            onBlur={form.touchName}
          />
          <TextField
            label="Port"
            mono
            inputMode="numeric"
            placeholder="5432"
            value={form.port}
            error={form.portError}
            disabled={!creating}
            onChange={(event) => form.setPort(event.target.value)}
            onBlur={form.touchPort}
          />
        </div>

        <div className={styles.preview} aria-live="polite">
          <span className={styles.previewLabel}>Opens at</span>
          <span className={styles.previewUrl}>{form.previewUrl ?? "…"}</span>
        </div>

        {form.conflict ? (
          <div className={styles.conflict} role="alert">
            <p>{form.conflict} Replace it with this port?</p>
            <Button
              size="sm"
              variant="danger"
              disabled={form.submitting}
              onClick={() => void form.replace()}
            >
              Replace
            </Button>
          </div>
        ) : null}
        {form.serverError ? (
          <p className={styles.serverError} role="alert">
            {form.serverError}
          </p>
        ) : null}

        <footer className={styles.footer}>
          <span className={styles.hint}>
            <Kbd>Esc</Kbd> to close
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!form.canSubmit}>
            {creating ? "Name port" : "Rename"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
