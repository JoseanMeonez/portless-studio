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
            <TextField
              label="Remove auto names after"
              mono
              inputMode="numeric"
              value={draft.autoRemoveMinutes}
              error={errors.autoRemoveAfterMinutes ?? null}
              hint="Minutes a name auto mode gave survives once its server stops. 0 keeps them. Names you or an agent gave are never removed."
              className={styles.short}
              onChange={(event) => form.change("autoRemoveMinutes", event.target.value)}
            />
            <Switch
              label={"Register “studio” in portless"}
              description="Open Studio itself at studio.localhost."
              checked={draft.registerStudioAlias}
              onChange={(value) => form.change("registerStudioAlias", value)}
            />
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Notifications</legend>
            <Switch
              label="Desktop notifications"
              description="New servers, names and stopped routes show as system notifications while Studio is in the background. This needs a Studio tab open."
              checked={draft.desktopNotifications}
              onChange={(value) => void form.setDesktopNotifications(value)}
            />
            {errors.desktopNotifications ? (
              <p className={styles.formError} role="alert">
                {errors.desktopNotifications}
              </p>
            ) : null}
            <Switch
              label="System notifications"
              description="With no Studio tab open, Studio asks the system to show new names and stopped routes. Clicking one opens Studio on Linux and Windows."
              checked={draft.systemNotifications}
              onChange={(value) => form.change("systemNotifications", value)}
            />
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Proxy</legend>
            <Switch
              label="Start the portless proxy"
              description="Studio starts it when it is not running, so the names open in the browser."
              checked={draft.startProxy}
              onChange={(value) => form.change("startProxy", value)}
            />
            <TextField
              label="Proxy port"
              mono
              inputMode="numeric"
              value={draft.proxyPort}
              error={errors.proxyPort ?? null}
              hint="1355 works on every system without a password. 443 drops the port from URLs but needs sudo once."
              className={styles.short}
              onChange={(event) => form.change("proxyPort", event.target.value)}
            />
            <Switch
              label="Use HTTPS"
              description="Off is recommended: browsers only trust the local certificate after extra system setup."
              checked={draft.proxyHttps}
              onChange={(value) => form.change("proxyHttps", value)}
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
