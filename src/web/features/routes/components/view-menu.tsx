import { useEffect, useRef } from "react";
import type { View } from "../../../../core/views/view.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./view-menu.module.css";

type ViewMenuProps = {
  views: readonly View[];
  /** Id of the saved view on screen. */
  currentId: string;
  defaultViewId: string;
  /** The view on screen has unsaved changes to its grouping, sort or filters. */
  modified: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (id: string) => void;
  onSaveAs: () => void;
  onSaveChanges: () => void;
  onResetChanges: () => void;
  onRename: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
};

/** The current view's name; opens a menu to switch, save, rename, delete or make it the default. */
export function ViewMenu({
  views,
  currentId,
  defaultViewId,
  modified,
  open,
  onOpenChange,
  onSwitch,
  onSaveAs,
  onSaveChanges,
  onResetChanges,
  onRename,
  onSetDefault,
  onDelete,
}: ViewMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = views.find((view) => view.id === currentId);

  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role^="menuitem"]:not(:disabled)')
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        trigger.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      // Arrow keys move between items, as in any menu.
      event.preventDefault();
      event.stopPropagation();
      const items = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>(
          '[role^="menuitem"]:not(:disabled)',
        ) ?? []),
      ];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? at + 1 : at - 1;
      items[(next + items.length) % items.length]?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  const choose = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${current?.name ?? ""}${modified ? " (changed)" : ""}. Switch or save views`}
        title="Views (V to switch, Shift+V for this menu)"
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="layers" size={14} className={styles.triggerIcon} />
        <span className={styles.triggerLabel}>{current?.name}</span>
        {modified ? <span className={styles.modified} aria-hidden="true" /> : null}
        <Icon name="chevronDown" size={12} className={styles.triggerIcon} />
      </button>
      {open ? (
        <div role="menu" aria-label="Views" className={styles.menu}>
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="menuitemradio"
              aria-checked={view.id === currentId}
              className={styles.item}
              onClick={() => choose(() => onSwitch(view.id))}
            >
              <span className={styles.check}>
                {view.id === currentId ? <Icon name="check" size={14} /> : null}
              </span>
              <span className={styles.itemLabel}>{view.name}</span>
              {view.id === defaultViewId ? <span className={styles.note}>Default</span> : null}
            </button>
          ))}
          <hr className={styles.separator} />
          {modified ? (
            <>
              <MenuItem
                label={`Save changes to ${current?.name ?? "view"}`}
                onClick={() => choose(onSaveChanges)}
              />
              <MenuItem label="Reset changes" onClick={() => choose(onResetChanges)} />
            </>
          ) : null}
          <MenuItem label="Save as new view…" onClick={() => choose(onSaveAs)} />
          <MenuItem label="Rename view…" onClick={() => choose(onRename)} />
          <MenuItem
            label="Set as default view"
            disabled={currentId === defaultViewId}
            onClick={() => choose(onSetDefault)}
          />
          <MenuItem
            label="Delete view"
            disabled={views.length <= 1}
            onClick={() => choose(onDelete)}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.check} />
      <span className={styles.itemLabel}>{label}</span>
    </button>
  );
}
