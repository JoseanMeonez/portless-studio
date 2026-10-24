import type { ReactNode } from "react";
import styles from "./badge.module.css";

type BadgeProps = {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string | undefined;
};

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[tone], className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
