import type { StudioEvent, StudioEventKind } from "../../core/api/contract.ts";

/** Shows an event as an operating system notification; clicking it should open `url`. */
export interface SystemNotifier {
  /** Returns at once and never throws: a missing notification tool only means no notification. */
  notify(event: StudioEvent, url: string): void;
}

/** Only these reach the OS, so a busy machine does not pile up notifications. */
export const SYSTEM_NOTIFICATION_KINDS: ReadonlySet<StudioEventKind> = new Set(["named", "down"]);
