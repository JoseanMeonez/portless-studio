import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { Spinner } from "../../../shared/ui/spinner.tsx";
import type { InstallStatus } from "../hooks/use-install-portless.ts";
import { CopyCommand } from "./copy-command.tsx";
import styles from "./install-portless-banner.module.css";

export const INSTALL_COMMAND = "npm install -g portless";

type InstallPortlessBannerProps = {
  status: InstallStatus;
  error: string | null;
  output: string | null;
  onInstall: () => void;
  onCopyCommand: (command: string) => void;
};

/** Shown when the server cannot run portless: what that means and how to install it. */
export function InstallPortlessBanner({
  status,
  error,
  output,
  onInstall,
  onCopyCommand,
}: InstallPortlessBannerProps) {
  const installing = status === "installing";
  return (
    <section className={styles.banner} aria-labelledby="install-portless-title">
      <div className={styles.header}>
        <span className={styles.icon}>
          <Icon name="warning" size={16} />
        </span>
        <div className={styles.intro}>
          <h2 id="install-portless-title" className={styles.title}>
            portless is not installed
          </h2>
          <p className={styles.text}>
            Studio shows the routes that portless creates, so it needs the portless command on this
            machine. Install it with npm from here, or run the command yourself.
          </p>
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={onInstall}
          disabled={installing}
          aria-busy={installing}
        >
          {installing ? <Spinner /> : <Icon name="terminal" size={14} />}
          {installing ? "Installing…" : "Install portless"}
        </Button>
        <div className={styles.command}>
          <CopyCommand
            command={INSTALL_COMMAND}
            description="Or run it in a terminal"
            onCopy={onCopyCommand}
          />
        </div>
      </div>

      {installing ? (
        <p className={styles.hint} role="status">
          Running {INSTALL_COMMAND}. This can take a minute.
        </p>
      ) : null}

      {status === "failed" && error ? (
        <div className={styles.error} role="alert">
          <strong className={styles.errorTitle}>The install failed.</strong>
          <pre className={styles.log}>{error}</pre>
          <span className={styles.errorHint}>
            If npm needs more permissions, run the command above in a terminal.
          </span>
        </div>
      ) : null}

      {status === "idle" && output ? (
        <details className={styles.details}>
          <summary className={styles.summary}>npm output</summary>
          <pre className={styles.log}>{output}</pre>
        </details>
      ) : null}
    </section>
  );
}
