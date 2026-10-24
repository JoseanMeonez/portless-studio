import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Kbd } from "../../../shared/ui/kbd.tsx";
import { SHORTCUT_GROUPS, SHORTCUTS } from "../hooks/shortcut-registry.ts";
import styles from "./shortcuts-dialog.module.css";

type ShortcutsDialogProps = {
  modifierLabel: string;
  onClose: () => void;
};

/** `?`: every shortcut, grouped, read from the same registry the keyboard handler uses. */
export function ShortcutsDialog({ modifierLabel, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} size="lg">
      <div className={styles.body}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} className={styles.group} aria-label={group}>
            <h3 className={styles.title}>{group}</h3>
            <dl className={styles.list}>
              {SHORTCUTS.filter((item) => item.group === group).map((item) => (
                <div key={item.id} className={styles.item} data-shortcut={item.id}>
                  <dt className={styles.label}>{item.label}</dt>
                  <dd className={styles.keys}>
                    {item.combos.map((combo, index) => (
                      <span key={combo.join("+")} className={styles.combo}>
                        {index > 0 ? <span className={styles.or}>or</span> : null}
                        {combo.map((key) => (
                          <Kbd key={key}>{key === "mod" ? modifierLabel : key}</Kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
