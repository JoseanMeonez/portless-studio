import { resolveStudioUrl } from "./studio-client.ts";

describe("resolveStudioUrl", () => {
  it("uses 127.0.0.1 and the configured port", () => {
    expect(resolveStudioUrl(undefined, 4949)).toEqual({ ok: true, value: "http://127.0.0.1:4949" });
    expect(resolveStudioUrl("", 5000)).toEqual({ ok: true, value: "http://127.0.0.1:5000" });
  });

  it("lets PORTLESS_STUDIO_URL win, without a trailing slash", () => {
    expect(resolveStudioUrl("http://127.0.0.1:5001/", 4949)).toEqual({
      ok: true,
      value: "http://127.0.0.1:5001",
    });
  });

  it("rejects a value that is not an http URL", () => {
    expect(resolveStudioUrl("ftp://x", 4949)).toMatchObject({ ok: false });
    expect(resolveStudioUrl("nope", 4949)).toMatchObject({ ok: false });
  });
});
