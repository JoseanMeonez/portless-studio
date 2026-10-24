const STORAGE_KEY = "portless-studio:selected-route";

/** The last selected row, so a reload puts the selection back where it was. */
export function readLastSelected(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLastSelected(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Storage is blocked; the selection simply starts at the top next time.
  }
}
