import styles from "./spinner.module.css";

/** A small spinning ring for buttons and inline progress. Decorative: pair it with text. */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
