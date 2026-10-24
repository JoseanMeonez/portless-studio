import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Spinner } from "../../../shared/ui/spinner.tsx";
import { Switch } from "../../../shared/ui/switch.tsx";
import { TagInput } from "../../../shared/ui/tag-input.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import type { SettingsForm } from "../hooks/use-settings-form.ts";
import styles from "./settings-dialog.module.css";

type SettingsDialogProps = {
  form: SettingsForm;
  onCopyPath: (path: string) => void;
  onClose: () => void;
};

/** Every Studio setting, the same ones the JSON config file holds. */
export function SettingsDialog({ form, onCopyPath, onClose }: SettingsDialogProps) {
  const { load, draft, errors } = form;
  return (
    <Dialog
      title="Settings"
      description="Saved to a JSON file on this machine."
      size="lg"
      onClose={onClose}
    >
      {load.status === "loading" ? (
        <div className={styles.loading}>
          <Spinner />
          Loading settings…
        </div>
      ) : null}
      {load.status === "failed" ? (
        <p className={styles.formError} role="alert">
          {load.message}
        </p>
      ) : null}

      {load.status === "ready" && draft ? (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.save();
          }}
        >
          <div className={styles.file}>
            <div className={styles.fileText}>
              <code className={styles.path} title={load.path}>
                {load.path}
              </code>
              <span className={styles.fileHint}>
                You can also edit this file by hand. Studio applies changes as soon as you save it.
              </span>
            </div>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              aria-label="Copy config path"
              title="Copy path"
              onClick={() => onCopyPath(load.path)}
            >
              <Icon name="copy" size={14} />
            </Button>
          </div>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Naming</legend>
            <Switch
              label="Auto-name new servers"
              description="Every new dev server that answers HTTP gets its suggested name."
              checked={draft.autoName}
              onChange={(value) => form.change("autoName", value)}
            />
            <Switch
              label={"Register “studio” in portless"}
              description="Open Studio itself at studio.localhost."
              checked={draft.registerStudioAlias}
              onChange={(value) => form.change("registerStudioAlias", value)}
            />
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Detection</legend>
            <TextField
              label="Scan interval"
              mono
              inputMode="decimal"
              value={draft.scanSeconds}
              error={errors.scanIntervalMs ?? null}
              hint="Seconds between looks for new listening ports."
              className={styles.short}
              onChange={(event) => form.change("scanSeconds", event.target.value)}
            />
            <TagInput
              label="Ignored ports"
              mono
              inputMode="numeric"
              placeholder="Add a port"
              values={draft.ignoredPorts.map(String)}
              error={errors.ignoredPorts ?? null}
              hint="Never shown as detected and never named automatically."
              onAdd={form.addIgnoredPort}
              onRemove={(value) => form.removeIgnoredPort(Number(value))}
            />
            <TagInput
              label="Ignored processes"
              mono
              placeholder="Add a process name"
              values={draft.ignoredProcesses}
              error={errors.ignoredProcesses ?? null}
              hint="Editors, browsers and chat apps that listen on ports but are not dev servers."
              onAdd={form.addIgnoredProcess}
              onRemove={form.removeIgnoredProcess}
            />
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Studio</legend>
            <Switch
              label="Open the browser on start"
              checked={draft.openBrowser}
              onChange={(value) => form.change("openBrowser", value)}
            />
            <TextField
              label="Studio port"
              mono
              inputMode="numeric"
              value={draft.port}
              error={errors.port ?? null}
              hint="Takes effect after restarting Studio."
              className={styles.short}
              onChange={(event) => form.change("port", event.target.value)}
            />
          </fieldset>

          {form.formError ? (
            <p className={styles.formError} role="alert">
              {form.formError}
            </p>
          ) : null}

          <footer className={styles.footer}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={form.saving}>
              {form.saving ? "Saving…" : "Save"}
            </Button>
          </footer>
        </form>
      ) : null}
    </Dialog>
  );
}
