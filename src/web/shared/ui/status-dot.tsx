import styles from "./status-dot.module.css";

type StatusDotProps = {
  tone: "success" | "warning" | "danger" | "neutral";
  /** A soft ring that breathes, for states that are still changing. */
  pulse?: boolean;
};

export function StatusDot({ tone, pulse = false }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.dot, styles[tone], pulse ? styles.pulse : ""].filter(Boolean).join(" ")}
    />
  );
}
