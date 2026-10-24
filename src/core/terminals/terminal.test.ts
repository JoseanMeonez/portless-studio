import { plainText } from "./terminal.ts";

describe("plainText", () => {
  it("removes color codes, cursor moves and window titles", () => {
    const raw = "\u001b[32mready\u001b[0m in \u001b[1m120 ms\u001b[22m\u001b[2K\u001b]0;vite\u0007";
    expect(plainText(raw)).toBe("ready in 120 ms");
  });

  it("turns CRLF into LF and keeps the last write of a redrawn line", () => {
    expect(plainText("one\r\ntwo\r\n")).toBe("one\ntwo\n");
    expect(plainText("10%\r50%\r100%\ndone")).toBe("100%\ndone");
  });
});
