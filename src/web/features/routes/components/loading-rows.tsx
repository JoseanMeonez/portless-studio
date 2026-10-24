import styles from "./loading-rows.module.css";

/** Placeholder rows while the first snapshot loads, so the layout does not jump. */
export function LoadingRows() {
  return (
    <div className={styles.list} aria-busy="true">
      <span className="visually-hidden">Loading routes</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className={styles.row}>
          <span className={styles.dot} />
          <span className={styles.lines}>
            <span className={styles.line} />
            <span className={`${styles.line} ${styles.short}`} />
          </span>
        </div>
      ))}
    </div>
  );
}
