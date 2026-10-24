/** Largest icon Studio inlines, in bytes; bigger files are not icons. */
export const MAX_ICON_BYTES = 64 * 1024;

// Base64 grows data by a third; the header is a few dozen characters.
const MAX_DATA_URL_LENGTH = Math.ceil((MAX_ICON_BYTES * 4) / 3) + 100;
const MAX_TEXT_ICON_CHARACTERS = 8;

/** How the page shows an icon: an image (`data:`), a remote image to inline first, or text. */
export type ProjectIconKind = "image" | "remote" | "text";

/**
 * What a project icon string is, or null when it cannot be one: an emoji or a few characters, an
 * `http(s)` URL the server fetches and inlines, or a `data:image/...` URL.
 */
export function projectIconKind(value: string): ProjectIconKind | null {
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value)) {
    return value.length <= MAX_DATA_URL_LENGTH ? "image" : null;
  }
  if (/^https?:\/\/\S+$/i.test(value)) return value.length <= 2048 ? "remote" : null;
  if (value.includes(":") || /[<>]/.test(value)) return null;
  const characters = Array.from(value).length;
  return characters > 0 && characters <= MAX_TEXT_ICON_CHARACTERS ? "text" : null;
}
