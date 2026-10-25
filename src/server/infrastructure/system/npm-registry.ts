/** Public npm metadata of the latest release; Studio sends nothing but this GET. */
export const LATEST_RELEASE_URL = "https://registry.npmjs.org/portless-studio/latest";

const TIMEOUT_MS = 3000;

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** The `version` npm reports as latest, or null on any failure, including the 3 s timeout. */
export async function fetchLatestVersion(
  options: { fetch?: FetchLike; url?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  try {
    const response = await fetchImpl(options.url ?? LATEST_RELEASE_URL, {
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const version =
      typeof body === "object" && body !== null ? Reflect.get(body, "version") : undefined;
    return typeof version === "string" && /^\d+\.\d+\.\d+\S*$/.test(version) ? version : null;
  } catch {
    return null;
  }
}
