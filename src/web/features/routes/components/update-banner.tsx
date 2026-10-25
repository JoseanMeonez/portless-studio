import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./update-banner.module.css";

type UpdateBannerProps = {
  current: string;
  latest: string;
  command: string;
  onCopyCommand: (command: string) => void;
  onDismiss: () => void;
};

/** Says a newer portless-studio is on npm and how to install it; hidden once dismissed. */
export function UpdateBanner({
  current,
  latest,
  command,
  onCopyCommand,
  onDismiss,
}: UpdateBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <Icon name="zap" className={styles.icon} />
      <p className={styles.text}>
        <strong className={styles.strong}>portless-studio {latest} is available</strong> (you run{" "}
        {current}). Update with <code className={styles.code}>{command}</code>, then restart Studio.
      </p>
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        aria-label={`Copy command: ${command}`}
        onClick={() => onCopyCommand(command)}
      >
        <Icon name="copy" size={14} />
      </Button>
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        aria-label="Dismiss the update notice"
        onClick={onDismiss}
      >
        <Icon name="x" size={14} />
      </Button>
    </div>
  );
}
