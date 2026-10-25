import {
  type UpdateCache,
  type UpdateCacheStore,
  UpdateChecker,
  updateChecksAllowed,
} from "./update-check.ts";

const DAY = 24 * 60 * 60 * 1000;

function memoryCache(initial: UpdateCache | null = null): UpdateCacheStore & {
  value: UpdateCache | null;
} {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(cache) {
      this.value = cache;
    },
  };
}

function checker(options: {
  latest?: () => Promise<string | null>;
  cache?: UpdateCacheStore;
  enabled?: boolean;
  now?: number;
}) {
  const fetchLatest = vi.fn(options.latest ?? (async () => "0.2.0"));
  const instance = new UpdateChecker({
    current: "0.1.0",
    enabled: async () => options.enabled ?? true,
    fetchLatest,
    cache: options.cache ?? memoryCache(),
    now: () => options.now ?? 10 * DAY,
  });
  return { instance, fetchLatest };
}

describe("UpdateChecker", () => {
  it("reports a newer version from the registry and caches it with the time", async () => {
    const cache = memoryCache();
    const { instance } = checker({ cache });
    expect(await instance.status()).toEqual({
      current: "0.1.0",
      latest: "0.2.0",
      available: true,
      command: "npm i -g portless-studio",
    });
    expect(cache.value).toEqual({ checkedAt: 10 * DAY, latest: "0.2.0" });
  });

  it("does not ask the registry again within a day", async () => {
    const cache = memoryCache({ checkedAt: 10 * DAY - DAY + 1000, latest: "0.3.0" });
    const { instance, fetchLatest } = checker({ cache });
    expect((await instance.status()).latest).toBe("0.3.0");
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("asks again once the cached check is a day old", async () => {
    const cache = memoryCache({ checkedAt: 9 * DAY, latest: "0.1.5" });
    const { instance, fetchLatest } = checker({ cache });
    expect((await instance.status()).latest).toBe("0.2.0");
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("runs one request for calls that overlap and remembers its answer", async () => {
    const { instance, fetchLatest } = checker({});
    await Promise.all([instance.status(), instance.status()]);
    await instance.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("says nothing is available when the running version is the latest", async () => {
    const { instance } = checker({ latest: async () => "0.1.0" });
    expect(await instance.status()).toMatchObject({ latest: "0.1.0", available: false });
  });

  it("ignores a failed request and does not retry it before a day passes", async () => {
    const cache = memoryCache();
    const { instance, fetchLatest } = checker({
      cache,
      latest: async () => {
        throw new Error("offline");
      },
    });
    expect(await instance.status()).toMatchObject({ latest: null, available: false });
    expect(cache.value).toEqual({ checkedAt: 10 * DAY, latest: null });
    await instance.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("never asks the registry while checks are off", async () => {
    const { instance, fetchLatest } = checker({ enabled: false });
    expect(await instance.status()).toMatchObject({ latest: null, available: false });
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});

describe("updateChecksAllowed", () => {
  it("allows checks in an ordinary shell", () => {
    expect(updateChecksAllowed({})).toBe(true);
  });

  it("turns them off in CI, in tests and with PORTLESS_STUDIO_NO_UPDATE_CHECK=1", () => {
    expect(updateChecksAllowed({ CI: "true" })).toBe(false);
    expect(updateChecksAllowed({ CI: "1" })).toBe(false);
    expect(updateChecksAllowed({ VITEST: "true" })).toBe(false);
    expect(updateChecksAllowed({ PORTLESS_STUDIO_NO_UPDATE_CHECK: "1" })).toBe(false);
  });

  it("treats an empty CI variable as not set", () => {
    expect(updateChecksAllowed({ CI: "" })).toBe(true);
  });
});
