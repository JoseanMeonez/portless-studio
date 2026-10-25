import { directUrl } from "./direct-url.ts";

describe("directUrl", () => {
  it("points at the port on localhost", () => {
    expect(directUrl(3000)).toBe("http://localhost:3000");
  });
});
