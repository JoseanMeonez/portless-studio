import { useEffect, useRef, useState } from "react";
import type { StudioEvent } from "../../../../core/api/contract.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

/** What a notification points at: a route by name, or a port. */
export type ItemTarget = StudioEvent["target"];

const READ_KEY = "portless-studio:events-read-at";
/**
 * Events this much older than the page were already announced to an earlier page (or to nobody):
 * they go in the list but get no toast, so a reload does not replay a burst of toasts.
 */
const RECENT_MS = 15_000;

/**
 * Turns server events into toasts with a Show button, desktop notifications while the tab is in
 * the background (when the setting is on and the browser allows them), and the bell's list with
 * its unread count. What was read is remembered in this browser.
 */
export function useNotifications(
  events: readonly StudioEvent[],
  onShow: (target: ItemTarget) => void,
) {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [readAt, setReadAt] = useState(readStoredReadAt);
  const seen = useRef(new Set<string>());
  const openedAt = useRef(Date.now());
  // Clicks arrive long after the render that created the toast; they must use the latest view.
  const show = useRef(onShow);
  useEffect(() => {
    show.current = onShow;
  });

  useEffect(() => {
    const notifyDesktop = async (event: StudioEvent) => {
      if (document.visibilityState !== "hidden") return;
      const api = globalThis.Notification;
      if (api?.permission !== "granted") return;
      const config = await gateway.getConfig();
      if (!config.ok || !config.value.config.desktopNotifications) return;
      try {
        const notification = new api(event.title, { body: event.body, tag: event.id });
        notification.onclick = () => {
          window.focus();
          show.current(event.target);
          notification.close();
        };
      } catch {
        // Some browsers only allow notifications from a service worker; the toast still shows.
      }
    };

    for (const event of events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (event.at < openedAt.current - RECENT_MS) continue;
      const { route, port } = event.target;
      toast({
        title: event.title,
        description: event.body,
        ...(route === undefined && port === undefined
          ? {}
          : { action: { label: "Show", onClick: () => show.current(event.target) } }),
      });
      void notifyDesktop(event);
    }
  }, [events, toast, gateway]);

  const markRead = () => {
    const latest = Math.max(readAt, ...events.map((event) => event.at));
    if (latest === readAt) return;
    setReadAt(latest);
    try {
      localStorage.setItem(READ_KEY, String(latest));
    } catch {
      // Not remembered, but read for this visit.
    }
  };

  return {
    /** Newest first. */
    recent: [...events].reverse(),
    unread: events.filter((event) => event.at > readAt).length,
    markRead,
  };
}

function readStoredReadAt(): number {
  try {
    const value = Number(localStorage.getItem(READ_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** `?focus=<route name>` or `?focus=port:<number>`, the link a system notification opens. */
export function parseFocus(value: string | null): ItemTarget | null {
  if (!value) return null;
  const port = /^port:(\d{1,5})$/.exec(value)?.[1];
  return port === undefined ? { route: value } : { port: Number(port) };
}
