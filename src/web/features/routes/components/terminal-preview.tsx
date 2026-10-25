import type { CSSProperties } from "react";
import type { TerminalAppearance } from "../../../../core/config/studio-config.ts";
import styles from "./terminal-preview.module.css";

/**
 * A few lines of a dev server drawn with the chosen font size, line height, cursor and colors,
 * from the same `--term-*` tokens the terminal reads.
 */
export function TerminalPreview({ appearance }: { appearance: TerminalAppearance }) {
  const style = {
    fontSize: `${appearance.fontSize}px`,
    lineHeight: appearance.lineHeight,
  } as CSSProperties;
  return (
    <div
      className={styles.preview}
      data-theme={appearance.theme}
      style={style}
      role="img"
      aria-label={`Terminal preview: ${appearance.theme} colors, ${appearance.fontSize} px`}
      data-testid="terminal-preview"
    >
      <div>
        <span className={styles.green}>➜</span> <span className={styles.cyan}>web</span>{" "}
        <span className={styles.blue}>git:(</span>
        <span className={styles.red}>main</span>
        <span className={styles.blue}>)</span> pnpm dev
      </div>
      <div>
        <span className={styles.magenta}>VITE</span> v6.0.0{" "}
        <span className={styles.dim}>ready in</span> <span className={styles.bold}>312 ms</span>
      </div>
      <div>
        <span className={styles.green}>➜</span> Local:{" "}
        <span className={styles.cyan}>http://localhost:5173/</span>
      </div>
      <div>
        <span className={styles.yellow}>warn</span>{" "}
        <span className={styles.dim}>unused import in app.tsx</span>
      </div>
      <div>
        <span className={styles.red}>error</span> Cannot find module{" "}
        <span className={styles.yellow}>'./missing'</span>
      </div>
      <div>
        <span className={styles.green}>$</span>{" "}
        <span
          className={styles.cursor}
          data-style={appearance.cursorStyle}
          data-blink={appearance.cursorBlink || undefined}
        />
      </div>
    </div>
  );
}
