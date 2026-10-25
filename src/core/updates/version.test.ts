import { compareVersions, isNewerVersion, updateMessage } from "./version.ts";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("puts a prerelease before its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });

  it("returns null for text that is not a version", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("is true only when the latest version is above the running one", () => {
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
  });
});

describe("updateMessage", () => {
  it("names both versions and the update command", () => {
    expect(updateMessage("0.1.0", "0.2.0")).toBe(
      "A new version of portless-studio is available: 0.1.0 -> 0.2.0. Update with: npm i -g portless-studio",
    );
  });
});
