import { Kbd } from "../../../shared/ui/kbd.tsx";
import styles from "./shortcut-hints.module.css";

/** One line under the list that teaches the keyboard shortcuts. */
export function ShortcutHints({ modifierLabel }: { modifierLabel: string }) {
  const hints: [keys: string[], label: string][] = [
    [["J", "K"], "move"],
    [["Enter"], "open"],
    [["C"], "copy URL"],
    [["R"], "rename"],
    [["N"], "name a port"],
    [[modifierLabel, "K"], "commands"],
  ];
  return (
    <ul className={styles.hints} aria-label="Keyboard shortcuts">
      {hints.map(([keys, label]) => (
        <li key={label} className={styles.hint}>
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
