import { fetchLatestVersion, LATEST_RELEASE_URL } from "./npm-registry.ts";

describe("fetchLatestVersion", () => {
  it("reads the version from the registry's latest release", async () => {
    const fetch = vi.fn(async () => Response.json({ name: "portless-studio", version: "0.2.0" }));
    expect(await fetchLatestVersion({ fetch })).toBe("0.2.0");
    expect(fetch).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.anything());
  });

  it("returns null for an error status, a body without a version or a failed request", async () => {
    expect(await fetchLatestVersion({ fetch: async () => new Response("", { status: 503 }) })).toBe(
      null,
    );
    expect(await fetchLatestVersion({ fetch: async () => Response.json({ version: 3 }) })).toBe(
      null,
    );
    expect(
      await fetchLatestVersion({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).toBe(null);
  });

  it("gives up when the registry does not answer in time", async () => {
    const hanging = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    expect(await fetchLatestVersion({ fetch: hanging, timeoutMs: 20 })).toBe(null);
  });
});
