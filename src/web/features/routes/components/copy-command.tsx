import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./copy-command.module.css";

type CopyCommandProps = {
  command: string;
  description: string;
  onCopy: (command: string) => void;
};

/** A terminal command shown as code, with a button that copies it. */
export function CopyCommand({ command, description, onCopy }: CopyCommandProps) {
  return (
    <div className={styles.command}>
      <div className={styles.text}>
        <span className={styles.description}>{description}</span>
        <code className={styles.code}>
          <span className={styles.prompt} aria-hidden="true">
            $
          </span>
          {command}
        </code>
      </div>
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        aria-label={`Copy command: ${command}`}
        onClick={() => onCopy(command)}
      >
        <Icon name="copy" size={14} />
      </Button>
    </div>
  );
}
