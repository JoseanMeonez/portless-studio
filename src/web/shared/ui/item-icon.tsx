import type { CSSProperties } from "react";
import { monogram } from "../lib/monogram.ts";
import styles from "./item-icon.module.css";

type ItemIconProps = {
  /** An emoji or a `data:image` URL; without one the icon is a monogram of `name`. */
  icon?: string | undefined;
  name: string;
  size?: "sm" | "md";
};

/** A project's icon: its image, its emoji, or its initials on a color made from the name. */
export function ItemIcon({ icon, name, size = "md" }: ItemIconProps) {
  const className = `${styles.icon} ${styles[size]}`;
  if (icon?.startsWith("data:image/")) {
    return <img className={`${className} ${styles.image}`} src={icon} alt="" aria-hidden="true" />;
  }
  if (icon) {
    return (
      <span className={`${className} ${styles.text}`} aria-hidden="true">
        {icon}
      </span>
    );
  }
  const { letters, hue } = monogram(name);
  return (
    <span
      className={`${className} ${styles.monogram}`}
      style={{ "--monogram-hue": hue } as CSSProperties}
      aria-hidden="true"
      data-monogram={letters}
    >
      {letters}
    </span>
  );
}
