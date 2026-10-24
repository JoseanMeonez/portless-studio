import { Kbd } from "../../../shared/ui/kbd.tsx";
import { type ShortcutId, shortcutKeys } from "../hooks/shortcut-registry.ts";
import styles from "./shortcut-hints.module.css";

/** The few shortcuts worth teaching on the page; `?` lists the rest. */
const HINTS: readonly { ids: readonly ShortcutId[]; label: string }[] = [
  { ids: ["move-down", "move-up"], label: "move" },
  { ids: ["open"], label: "open" },
  { ids: ["copy"], label: "copy URL" },
  { ids: ["favorite"], label: "favorite" },
  { ids: ["name-port"], label: "name a port" },
  { ids: ["command-menu"], label: "commands" },
  { ids: ["help"], label: "all shortcuts" },
];

/** One line under the list that teaches the keyboard shortcuts. */
export function ShortcutHints({ modifierLabel }: { modifierLabel: string }) {
  return (
    <ul className={styles.hints} aria-label="Keyboard shortcuts">
      {HINTS.map(({ ids, label }) => (
        <li key={label} className={styles.hint}>
          {ids
            .flatMap((id) => shortcutKeys(id, modifierLabel))
            .map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
