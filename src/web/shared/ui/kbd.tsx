import type { ReactNode } from "react";
import styles from "./kbd.module.css";

type KbdProps = {
  children: ReactNode;
  className?: string | undefined;
};

/** A key hint, such as `/` or `⌘ K`. */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={[styles.kbd, className].filter(Boolean).join(" ")}>{children}</kbd>;
}
