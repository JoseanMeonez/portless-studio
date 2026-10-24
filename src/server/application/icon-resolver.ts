import { projectIconKind } from "../../core/projects/project-icon.ts";

/** Reads icons from outside Studio. Every answer is a `data:image` URL or null. */
export interface IconFetcher {
  /** The favicon a server on this loopback port serves. */
  served(port: number): Promise<string | null>;
  /** An http(s) image a person set in the config, inlined so the page never loads another origin. */
  remote(url: string): Promise<string | null>;
  /** A favicon file in the project folder, e.g. `public/favicon.svg`. */
  inFolder(rootDir: string): string | null;
}

/** What an icon is looked up for: a route or a detected port. */
export type IconSubject = {
  port: number;
  pid: number | null;
  /** Project name, the key of `projectIcons` in the config. */
  project: string | null;
  /** Project folder, where a favicon file may live. */
  rootDir: string | null;
};

// Enough for every port on a busy machine; the oldest answers go first.
const MAX_CACHED = 500;

/**
 * Picks the icon for a route or detected port: the project's icon from the config, then the
 * favicon its server serves, then a favicon in its folder. Null means the page draws a monogram.
 * Fetches run in the background, once per URL and per port and pid; `onLoaded` fires when one
 * finds an icon, so the snapshot can be sent again.
 */
export class IconResolver {
  readonly #fetcher: IconFetcher;
  readonly #onLoaded: () => void;
  /** Settled answers by key; a key that is present but undefined is still loading. */
  readonly #fetched = new Map<string, string | null | undefined>();
  readonly #folders = new Map<string, string | null>();

  constructor(fetcher: IconFetcher, onLoaded: () => void) {
    this.#fetcher = fetcher;
    this.#onLoaded = onLoaded;
  }

  iconFor(subject: IconSubject, configured: Readonly<Record<string, string>>): string | null {
    const own = subject.project === null ? null : this.configuredIcon(subject.project, configured);
    if (own !== null) return own;
    const served = this.#load(`port:${subject.port}:${subject.pid ?? ""}`, () =>
      this.#fetcher.served(subject.port),
    );
    if (served) return served;
    return subject.rootDir === null ? null : this.#folderIcon(subject.rootDir);
  }

  /** The icon a person set for this project, inlined; null when none is set or it is loading. */
  configuredIcon(project: string, configured: Readonly<Record<string, string>>): string | null {
    const value = Object.hasOwn(configured, project) ? configured[project] : undefined;
    if (value === undefined) return null;
    const kind = projectIconKind(value);
    if (kind === "remote")
      return this.#load(`url:${value}`, () => this.#fetcher.remote(value)) ?? null;
    return kind === null ? null : value;
  }

  #load(key: string, fetch: () => Promise<string | null>): string | null | undefined {
    if (this.#fetched.has(key)) return this.#fetched.get(key);
    remember(this.#fetched, key, undefined);
    fetch()
      .catch(() => null)
      .then((icon) => {
        this.#fetched.set(key, icon);
        if (icon !== null) this.#onLoaded();
      });
    return undefined;
  }

  #folderIcon(rootDir: string): string | null {
    if (this.#folders.has(rootDir)) return this.#folders.get(rootDir) ?? null;
    const icon = this.#fetcher.inFolder(rootDir);
    remember(this.#folders, rootDir, icon);
    return icon;
  }
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value);
  if (map.size > MAX_CACHED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}
