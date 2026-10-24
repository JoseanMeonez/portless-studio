import { OutputBuffer } from "./output-buffer.ts";

describe("OutputBuffer", () => {
  it("numbers output by character offset and reads from any point", () => {
    const buffer = new OutputBuffer(100);
    expect(buffer.append("hello ")).toBe(6);
    expect(buffer.append("world")).toBe(11);
    expect(buffer.read(0)).toEqual({ data: "hello world", from: 0, next: 11, truncated: false });
    expect(buffer.read(6)).toEqual({ data: "world", from: 6, next: 11, truncated: false });
    expect(buffer.read(11)).toEqual({ data: "", from: 11, next: 11, truncated: false });
  });

  it("drops the oldest output past its size and says the read was cut", () => {
    const buffer = new OutputBuffer(10);
    buffer.append("aaaaaa");
    buffer.append("bbbbbb");
    expect(buffer.start).toBe(2);
    expect(buffer.end).toBe(12);
    expect(buffer.read(0)).toEqual({ data: "aaaabbbbbb", from: 2, next: 12, truncated: true });
  });

  it("keeps only the tail of one chunk larger than the whole buffer", () => {
    const buffer = new OutputBuffer(4);
    buffer.append("0123456789");
    expect(buffer.read(0)).toEqual({ data: "6789", from: 6, next: 10, truncated: true });
  });

  it("limits how much one read returns", () => {
    const buffer = new OutputBuffer(100);
    buffer.append("abc");
    buffer.append("defgh");
    expect(buffer.read(1, 4)).toEqual({ data: "bcde", from: 1, next: 5, truncated: false });
  });

  it("treats a start past the end as the end", () => {
    const buffer = new OutputBuffer(100);
    buffer.append("abc");
    expect(buffer.read(50)).toEqual({ data: "", from: 3, next: 3, truncated: false });
  });
});
