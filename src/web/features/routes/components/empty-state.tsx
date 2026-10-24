import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { CopyCommand } from "./copy-command.tsx";
import styles from "./empty-state.module.css";

type EmptyStateProps = {
  onCopyCommand: (command: string) => void;
  onNamePort: () => void;
};

/** Shown when portless has no routes: how to get the first one. */
export function EmptyState({ onCopyCommand, onNamePort }: EmptyStateProps) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <span className={styles.icon}>
        <Icon name="terminal" size={20} />
      </span>
      <h2 id="empty-title" className={styles.title}>
        No routes yet
      </h2>
      <p className={styles.text}>
        Start a dev server through portless and it shows up here with its own name. Or give a name
        to a port that is already running.
      </p>
      <div className={styles.commands}>
        <CopyCommand
          command="portless myapp pnpm dev"
          description="Run your dev server as myapp.localhost"
          onCopy={onCopyCommand}
        />
        <CopyCommand
          command="portless alias db 5432"
          description="Name a port that is already running"
          onCopy={onCopyCommand}
        />
      </div>
      <Button variant="secondary" size="sm" onClick={onNamePort}>
        <Icon name="plus" size={14} />
        Name a port
      </Button>
    </section>
  );
}
