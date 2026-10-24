/** A name auto mode gave, so it can be taken back once its server is gone for good. */
export type AutoNamedEntry = { name: string; port: number; createdAt: number };

/**
 * Where the names auto mode gave are remembered across restarts. The default implementation is
 * a small JSON file next to the config; names a person or an agent gave are never in it.
 */
export interface AutoNamedStore {
  read(): Promise<AutoNamedEntry[]>;
  write(entries: AutoNamedEntry[]): Promise<void>;
}

/** Keeps the list in memory only; for tests and for `init`, which runs once. */
export function memoryAutoNamedStore(): AutoNamedStore {
  let entries: AutoNamedEntry[] = [];
  return {
    read: async () => entries,
    write: async (next) => {
      entries = next;
    },
  };
}
