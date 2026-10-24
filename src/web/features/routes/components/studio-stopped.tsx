import { CopyCommand } from "./copy-command.tsx";
import styles from "./studio-stopped.module.css";

type StudioStoppedProps = {
  startCommand: string;
  onCopy: (command: string) => void;
};

/** The last screen after stopping Studio from its own page: the server is gone, so say how to return. */
export function StudioStopped({ startCommand, onCopy }: StudioStoppedProps) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Studio stopped</h1>
        <p className={styles.text}>
          This page no longer gets updates. Start Studio again in a terminal, then reload the page.
        </p>
        <CopyCommand command={startCommand} description="Start Studio" onCopy={onCopy} />
      </div>
    </main>
  );
}
