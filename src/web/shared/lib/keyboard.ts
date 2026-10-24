/** True when the key press is going into a text field, so single-letter shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset"].includes(target.type);
  }
  return false;
}

/** True when Enter or Space already has a meaning for the focused element (it would click it). */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("button, a[href], [role='button'], summary") !== null;
}

/** Cmd on macOS, Ctrl elsewhere: the modifier for app-wide shortcuts like the command menu. */
export function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function hasAnyModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform ?? "");
}

export function modifierLabel(): string {
  return isApplePlatform() ? "⌘" : "Ctrl";
}
