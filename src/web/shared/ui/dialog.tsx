import { type ReactNode, useId, useRef } from "react";
import styles from "./dialog.module.css";
import { useFocusTrap } from "./use-focus-trap.ts";

type DialogProps = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/** A modal panel. Mount it to open it, unmount it to close it; focus returns to the opener. */
export function Dialog({ title, description, onClose, children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(panel, onClose);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside closes; Esc is the keyboard way.
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={styles.panel}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}
