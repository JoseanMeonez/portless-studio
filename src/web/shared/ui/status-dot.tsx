import styles from "./status-dot.module.css";

type StatusDotProps = {
  tone: "success" | "warning" | "danger" | "neutral";
  /** A soft ring that breathes, for states that are still changing. */
  pulse?: boolean;
  /** What the color means, as a tooltip and for screen readers. Without it the dot is decorative. */
  label?: string;
};

export function StatusDot({ tone, pulse = false, label }: StatusDotProps) {
  const className = [styles.dot, styles[tone], pulse ? styles.pulse : ""].filter(Boolean).join(" ");
  if (label) return <span role="img" aria-label={label} title={label} className={className} />;
  return <span aria-hidden="true" className={className} />;
}
