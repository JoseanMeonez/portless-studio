/** What one read of a terminal's output returns. */
export type OutputSlice = {
  data: string;
  /** Offset of the first character of `data`; later than asked when older output was dropped. */
  from: number;
  /** Offset to ask for next time to get only newer output. */
  next: number;
  /** True when output between the asked offset and `from` was dropped to stay under the limit. */
  truncated: boolean;
};

/**
 * A terminal's output, newest `maxChars` characters kept. Every character has an offset that never
 * changes (the sequence number), so a client that read up to `next` can ask for only what came
 * after, and one that fell behind learns how much it missed.
 */
export class OutputBuffer {
  readonly #maxChars: number;
  #chunks: string[] = [];
  #start = 0;
  #end = 0;

  constructor(maxChars: number) {
    this.#maxChars = maxChars;
  }

  /** Offset of the oldest character still kept. */
  get start(): number {
    return this.#start;
  }

  /** Offset just past the newest character, i.e. how many characters were ever written. */
  get end(): number {
    return this.#end;
  }

  /** Adds output and returns the new end offset. */
  append(text: string): number {
    if (text === "") return this.#end;
    this.#chunks.push(text);
    this.#end += text.length;
    this.#trim();
    return this.#end;
  }

  read(from: number, maxChars = Number.POSITIVE_INFINITY): OutputSlice {
    const wanted = Math.max(0, Math.min(from, this.#end));
    const begin = Math.max(wanted, this.#start);
    const all = this.#chunks.join("");
    this.#chunks = all === "" ? [] : [all];
    const data = all.slice(begin - this.#start, begin - this.#start + Math.max(0, maxChars));
    return { data, from: begin, next: begin + data.length, truncated: begin > wanted };
  }

  #trim(): void {
    let size = this.#end - this.#start;
    while (size > this.#maxChars && this.#chunks.length > 0) {
      const first = this.#chunks[0] ?? "";
      const extra = size - this.#maxChars;
      if (first.length <= extra) {
        this.#chunks.shift();
        this.#start += first.length;
        size -= first.length;
      } else {
        this.#chunks[0] = first.slice(extra);
        this.#start += extra;
        size -= extra;
      }
    }
  }
}
