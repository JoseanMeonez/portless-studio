import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./context-menu.module.css";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/icon-paths.ts";

export type MenuItem = {
  kind: "item";
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuSubmenu = {
  kind: "submenu";
  id: string;
  label: string;
  icon?: IconName;
  entries: readonly MenuEntry[];
};

export type MenuEntry = MenuItem | MenuSubmenu | { kind: "separator"; id: string };

type ContextMenuProps = {
  /** Accessible name of the menu, e.g. "Actions for web.acme". */
  label: string;
  /** Viewport point the menu opens at; it moves left or up to stay on screen. */
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  onClose: () => void;
};

/** Distance kept from the viewport edges. */
const EDGE = 8;

/**
 * A menu at the pointer, like the one a desktop app shows on right-click: arrow keys move, Enter
 * runs, Right opens a submenu and Left closes it, Esc or a click outside closes the menu and gives
 * focus back to where it was.
 */
export function ContextMenu({ label, x, y, entries, onClose }: ContextMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<{
    id: string;
    x: number;
    y: number;
    /** Opened from the keyboard, so its first item takes the focus. */
    focus: boolean;
  } | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  // Gives focus back to the element that had it, as native menus do.
  useEffect(() => {
    const previous = document.activeElement;
    focusItem(root.current, 0);
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    setPosition(clamp(x, y, element));
  }, [x, y]);

  useEffect(() => {
    const close = () => latestClose.current();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (root.current?.contains(target) || sub.current?.contains(target))) return;
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const submenu = entries.find(
    (entry): entry is MenuSubmenu => entry.kind === "submenu" && entry.id === openSub?.id,
  );

  const openSubmenu = (entry: MenuSubmenu, trigger: HTMLElement, focusFirst: boolean) => {
    const rect = trigger.getBoundingClientRect();
    setOpenSub({ id: entry.id, x: rect.right, y: rect.top, focus: focusFirst });
  };

  const run = (entry: MenuEntry, trigger: HTMLElement, fromKeyboard: boolean) => {
    if (entry.kind === "separator") return;
    if (entry.kind === "submenu") {
      openSubmenu(entry, trigger, fromKeyboard);
      return;
    }
    if (entry.disabled) return;
    onClose();
    entry.onSelect();
  };

  const onRootKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(root.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const entry = enabledEntries(entries)[current];
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowRight" && entry?.kind === "submenu") {
      event.preventDefault();
      const trigger = items[current];
      if (trigger) openSubmenu(entry, trigger, true);
    } else if (!moveFocus(event, items, current) && isActivation(event) && entry) {
      event.preventDefault();
      const trigger = items[current];
      if (trigger) run(entry, trigger, true);
    }
  };

  const onSubKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const items = menuItems(sub.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const entry = submenu ? enabledEntries(submenu.entries)[current] : undefined;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      setOpenSub(null);
      focusTrigger(root.current, openSub?.id);
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (!moveFocus(event, items, current) && isActivation(event) && entry) {
      event.preventDefault();
      const trigger = items[current];
      if (trigger) run(entry, trigger, true);
    }
  };

  return createPortal(
    <>
      <div
        ref={root}
        role="menu"
        aria-label={label}
        className={styles.menu}
        style={{ left: position.left, top: position.top }}
        onKeyDown={onRootKey}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MenuEntries
          entries={entries}
          openId={openSub?.id ?? null}
          onRun={(entry, element) => run(entry, element, false)}
          onHoverSubmenu={(entry, element) =>
            entry ? openSubmenu(entry, element, false) : setOpenSub(null)
          }
        />
      </div>
      {submenu && openSub ? (
        <Submenu
          ref={sub}
          entry={submenu}
          x={openSub.x}
          y={openSub.y}
          focusFirst={openSub.focus}
          avoid={root.current}
          onKeyDown={onSubKey}
          onRun={(entry, element) => run(entry, element, false)}
        />
      ) : null}
    </>,
    document.body,
  );
}

type SubmenuProps = {
  ref: Ref<HTMLDivElement>;
  entry: MenuSubmenu;
  x: number;
  y: number;
  focusFirst: boolean;
  /** The parent menu, which the submenu opens beside without covering it when there is room. */
  avoid: HTMLElement | null;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onRun: (entry: MenuEntry, element: HTMLElement) => void;
};

function Submenu({ ref, entry, x, y, focusFirst, avoid, onKeyDown, onRun }: SubmenuProps) {
  const own = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useEffect(() => {
    if (focusFirst) focusItem(own.current, 0);
  }, [focusFirst]);
  useLayoutEffect(() => {
    const element = own.current;
    if (!element) return;
    const width = element.offsetWidth;
    const parentLeft = avoid?.getBoundingClientRect().left ?? x;
    // No room on the right: open to the left of the parent menu, then clamp to the viewport.
    const left = x + width + EDGE > window.innerWidth ? parentLeft - width : x;
    setPosition(clamp(left, y, element));
  }, [x, y, avoid]);
  return (
    <div
      ref={(element) => {
        own.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      role="menu"
      aria-label={entry.label}
      className={styles.menu}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuEntries entries={entry.entries} openId={null} onRun={onRun} />
    </div>
  );
}

type MenuEntriesProps = {
  entries: readonly MenuEntry[];
  openId: string | null;
  onRun: (entry: MenuEntry, element: HTMLElement) => void;
  onHoverSubmenu?: (entry: MenuSubmenu | null, element: HTMLElement) => void;
};

function MenuEntries({ entries, openId, onRun, onHoverSubmenu }: MenuEntriesProps) {
  return entries.map((entry) => {
    if (entry.kind === "separator") {
      return <hr key={entry.id} className={styles.separator} />;
    }
    const submenu = entry.kind === "submenu";
    const disabled = entry.kind === "item" && entry.disabled === true;
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={styles.item}
        data-menu-id={entry.id}
        aria-disabled={disabled || undefined}
        aria-haspopup={submenu ? "menu" : undefined}
        aria-expanded={submenu ? openId === entry.id : undefined}
        onClick={(event) => onRun(entry, event.currentTarget)}
        onPointerEnter={(event) => {
          event.currentTarget.focus();
          onHoverSubmenu?.(submenu ? entry : null, event.currentTarget);
        }}
      >
        {entry.icon ? <Icon name={entry.icon} size={14} className={styles.icon} /> : null}
        <span className={styles.label}>{entry.label}</span>
        {submenu ? <Icon name="chevronRight" size={14} className={styles.chevron} /> : null}
      </button>
    );
  });
}

function enabledEntries(entries: readonly MenuEntry[]): Array<MenuItem | MenuSubmenu> {
  return entries.filter((entry): entry is MenuItem | MenuSubmenu => entry.kind !== "separator");
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>(":scope > [role='menuitem']")] : [];
}

function focusItem(menu: HTMLElement | null, index: number): void {
  menuItems(menu)[index]?.focus();
}

function focusTrigger(menu: HTMLElement | null, id: string | undefined): void {
  if (!menu || id === undefined) return;
  menuItems(menu)
    .find((item) => item.dataset.menuId === id)
    ?.focus();
}

/** Arrow keys, Home and End move the focus with wrap-around; true when the key was one of them. */
function moveFocus(
  event: ReactKeyboardEvent,
  items: readonly HTMLElement[],
  current: number,
): boolean {
  const last = items.length - 1;
  const targets: Record<string, number> = {
    ArrowDown: current >= last ? 0 : current + 1,
    ArrowUp: current <= 0 ? last : current - 1,
    Home: 0,
    End: last,
  };
  const next = targets[event.key];
  if (next === undefined) return false;
  event.preventDefault();
  items[next]?.focus();
  return true;
}

function isActivation(event: ReactKeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

/** Moves a box left or up so it stays inside the viewport, at least `EDGE` from each side. */
function clamp(x: number, y: number, element: HTMLElement): { left: number; top: number } {
  const maxLeft = window.innerWidth - element.offsetWidth - EDGE;
  const maxTop = window.innerHeight - element.offsetHeight - EDGE;
  return {
    left: Math.max(EDGE, Math.min(x, maxLeft)),
    top: Math.max(EDGE, Math.min(y, maxTop)),
  };
}
