import { monogram } from "./monogram.ts";

describe("monogram", () => {
  it("takes the first letters of the first two words", () => {
    expect(monogram("shop-admin").letters).toBe("SA");
    expect(monogram("@acme/web").letters).toBe("AW");
    expect(monogram("falcon").letters).toBe("F");
  });

  it("gives the same name the same hue, from 0 to 359", () => {
    expect(monogram("otter").hue).toBe(monogram("otter").hue);
    for (const name of ["acme", "falcon", "otter", "shop-admin"]) {
      const { hue } = monogram(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("falls back to a question mark when the name has no letters or digits", () => {
    expect(monogram("--").letters).toBe("?");
  });
});
