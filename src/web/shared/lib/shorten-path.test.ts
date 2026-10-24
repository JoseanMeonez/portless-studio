import { shortenPath } from "./shorten-path.ts";

describe("shortenPath", () => {
  it("replaces the home folder with ~ on Linux, macOS and Windows", () => {
    expect(shortenPath("/home/dev/code/app")).toBe("~/code/app");
    expect(shortenPath("/Users/dev/code/app")).toBe("~/code/app");
    expect(shortenPath("C:\\Users\\dev\\code\\app")).toBe("~\\code\\app");
  });

  it("keeps the last folders of a deep path", () => {
    expect(shortenPath("/srv/projects/acme/apps/web/packages/ui")).toBe("…/web/packages/ui");
  });

  it("leaves short paths alone", () => {
    expect(shortenPath("/srv/app")).toBe("/srv/app");
  });
});
