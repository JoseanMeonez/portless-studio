import { directUrl } from "../../../../core/ports/direct-url.ts";
import styles from "./direct-url.module.css";

type DirectUrlProps = {
  port: number;
  onCopy: () => void;
};

/** `http://localhost:<port>` in small monospace; a click copies it. */
export function DirectUrl({ port, onCopy }: DirectUrlProps) {
  const url = directUrl(port);
  return (
    <button
      type="button"
      className={styles.directUrl}
      aria-label={`Copy direct URL ${url}`}
      title="Copy direct URL"
      onClick={(event) => {
        // The row would take the click as a selection.
        event.stopPropagation();
        onCopy();
      }}
    >
      {url}
    </button>
  );
}
