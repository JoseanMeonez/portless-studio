import { useEffect, useRef, useState } from "react";
import type { ProxyAction } from "../../../../core/api/contract.ts";
import type { ProxyStatus } from "../../../../core/routes/route.ts";
import styles from "./proxy-menu.module.css";
import { ProxyStatusPill } from "./proxy-status-pill.tsx";

type ProxyMenuProps = {
  proxy: ProxyStatus;
  portlessVersion: string | null;
  /** The action running right now; the menu waits for it. */
  busy: ProxyAction | null;
  onAction: (action: ProxyAction) => void;
};

const ITEMS: ReadonlyArray<{ action: ProxyAction; label: string; needsRunning: boolean }> = [
  { action: "start", label: "Start proxy", needsRunning: false },
  { action: "restart", label: "Restart proxy", needsRunning: true },
  { action: "stop", label: "Stop proxy", needsRunning: true },
];

/** The proxy status pill, which opens a menu to start, restart or stop the proxy. */
export function ProxyMenu({ proxy, portlessVersion, busy, onAction }: ProxyMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
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

  const choose = (action: ProxyAction) => {
    setOpen(false);
    onAction(action);
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Proxy: ${proxy.running ? "running" : "stopped"}. Start, stop or restart it`}
        onClick={() => setOpen((value) => !value)}
      >
        <ProxyStatusPill proxy={proxy} portlessVersion={portlessVersion} />
      </button>
      {open ? (
        <div role="menu" aria-label="Proxy actions" className={styles.menu}>
          {ITEMS.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={busy !== null || item.needsRunning !== proxy.running}
              onClick={() => choose(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
