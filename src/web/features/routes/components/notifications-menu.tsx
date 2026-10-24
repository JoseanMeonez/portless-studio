import { useEffect, useRef, useState } from "react";
import type { StudioEvent } from "../../../../core/api/contract.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./notifications-menu.module.css";

type NotificationsMenuProps = {
  /** Newest first. */
  events: readonly StudioEvent[];
  unread: number;
  /** Opening the list marks everything in it as read. */
  onOpen: () => void;
  onSelect: (event: StudioEvent) => void;
};

/** The bell in the header: how many notifications are unread, and the recent ones. */
export function NotificationsMenu({ events, unread, onOpen, onSelect }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) onOpen();
    setOpen(!open);
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        onClick={toggle}
      >
        <Icon name="bell" />
        {unread > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="menu" aria-label="Notifications" className={styles.menu}>
          {events.length === 0 ? (
            <p className={styles.empty}>Nothing yet. New servers and names show up here.</p>
          ) : (
            events.map((event) => (
              <button
                key={event.id}
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onSelect(event);
                }}
              >
                <span className={styles.itemHead}>
                  <span className={styles.itemTitle}>{event.title}</span>
                  <time className={styles.time} dateTime={new Date(event.at).toISOString()}>
                    {timeOfDay(event.at)}
                  </time>
                </span>
                <span className={styles.itemBody}>{event.body}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
