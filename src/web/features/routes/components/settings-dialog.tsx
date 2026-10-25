import type { ReactNode } from "react";
import { NAME_TOKEN_HELP, NAME_TOKENS } from "../../../../core/ports/name-template.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Spinner } from "../../../shared/ui/spinner.tsx";
import { Switch } from "../../../shared/ui/switch.tsx";
import { TagInput } from "../../../shared/ui/tag-input.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import type { SettingsForm } from "../hooks/use-settings-form.ts";
import { ProjectIconsField } from "./project-icons-field.tsx";
import styles from "./settings-dialog.module.css";

type SettingsDialogProps = {
  form: SettingsForm;
  /** Projects on the dashboard, offered in the icon settings. */
  projects: readonly string[];
  onCopyPath: (path: string) => void;
  onClose: () => void;
  /** The open-with apps section, which loads and saves on its own. */
  customApps?: ReactNode;
};

/** Every Studio setting, the same ones the JSON config file holds. */
export function SettingsDialog({
  form,
  projects,
  onCopyPath,
  onClose,
  customApps,
}: SettingsDialogProps) {
  const { load, draft, errors } = form;
  // Projects with an icon stay listed even when none of their servers runs now.
  const iconProjects = draft
    ? [...new Set([...projects, ...Object.keys(draft.projectIcons)])].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];
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
              label="Name template"
              mono
              value={draft.nameTemplate}
              error={errors.nameTemplate ?? form.namePreview?.error ?? null}
              hint="How suggested names are built. Labels left empty are dropped."
              onChange={(event) => form.change("nameTemplate", event.target.value)}
            />
            <p className={styles.preview}>
              {form.namePreview?.name ? (
                <>
                  An app in <code>acme-monorepo</code> on branch <code>feat/ED-1234-add-login</code>{" "}
                  gets{" "}
                  <code data-testid="name-preview" className={styles.previewName}>
                    {form.namePreview.name}
                  </code>
                </>
              ) : (
                "This template gives the example app no name."
              )}
            </p>
            <dl className={styles.tokens}>
              {NAME_TOKENS.map((token) => (
                <div key={token} className={styles.token}>
                  <dt>
                    <code>{`{${token}}`}</code>
                  </dt>
                  <dd>{NAME_TOKEN_HELP[token]}</dd>
                </div>
              ))}
            </dl>
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
            <Switch
              label="Show Studio in the routes"
              description="List Studio's own studio route with the others. Off keeps the list for your apps."
              checked={draft.showStudioRoute}
              onChange={(value) => form.change("showStudioRoute", value)}
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
              hint="1355 works on every system without a password. portless asks for sudo below 1024 on Linux and macOS; turn on Short URLs instead to drop the port."
              className={styles.short}
              onChange={(event) => form.change("proxyPort", event.target.value)}
            />
            <Switch
              label="Short URLs (port 80)"
              description={
                <>
                  Names open as <code>http://name.localhost</code>: Studio listens on port 80 and
                  forwards to the proxy, which stays on its port. Studio never asks for a password,
                  so this works only where your user may listen on port 80. Windows: usually yes,
                  unless a program such as IIS holds it. macOS: usually yes. Linux: run{" "}
                  <code>sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80</code> once. HTTP
                  only; the Health panel says whether it works.
                </>
              }
              checked={draft.shortUrls}
              onChange={(value) => form.change("shortUrls", value)}
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
            <legend className={styles.legend}>Project icons</legend>
            <ProjectIconsField
              projects={iconProjects}
              icons={draft.projectIcons}
              error={errors.projectIcons ?? null}
              onChange={form.setProjectIcon}
            />
          </fieldset>

          {customApps ? (
            <fieldset className={styles.group}>
              <legend className={styles.legend}>Open with</legend>
              {customApps}
            </fieldset>
          ) : null}

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Studio</legend>
            <Switch
              label="Open the browser on start"
              checked={draft.openBrowser}
              onChange={(value) => form.change("openBrowser", value)}
            />
            <Switch
              label="Check for updates"
              description="Once a day Studio asks the npm registry for the latest portless-studio version and says when a newer one is out. It sends nothing about this machine."
              checked={draft.checkForUpdates}
              onChange={(value) => form.change("checkForUpdates", value)}
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
