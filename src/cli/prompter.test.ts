import { PassThrough } from "node:stream";
import { createDefaultsPrompter, createTerminalPrompter } from "./prompter.ts";

function terminal(lines: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  const prompter = createTerminalPrompter(input, output);
  // Feed one line each time a question is printed.
  const queue = [...lines];
  output.on("data", () => {
    const next = queue.shift();
    if (next !== undefined) setImmediate(() => input.write(`${next}\n`));
  });
  return { prompter, written: () => written };
}

describe("createTerminalPrompter", () => {
  it("reads yes, no and empty answers, asking again on anything else", async () => {
    const { prompter } = terminal(["", "n", "maybe", "YES"]);
    expect(await prompter.confirm("First?")).toBe(true);
    expect(await prompter.confirm("Second?")).toBe(false);
    expect(await prompter.confirm("Third?")).toBe(true);
    prompter.close();
  });

  it("returns the default for an empty text answer", async () => {
    const { prompter, written } = terminal(["", " 5050 "]);
    expect(await prompter.ask("Port?", "4949")).toBe("4949");
    expect(await prompter.ask("Port?", "4949")).toBe("5050");
    expect(written()).toContain("(4949)");
    prompter.close();
  });
});

describe("createDefaultsPrompter", () => {
  it("answers every question with its default and prints it", async () => {
    const lines: string[] = [];
    const prompter = createDefaultsPrompter((line) => lines.push(line));
    expect(await prompter.confirm("Do it?")).toBe(true);
    expect(await prompter.confirm("Skip it?", false)).toBe(false);
    expect(await prompter.ask("Port?", "4949")).toBe("4949");
    expect(lines).toEqual(["? Do it? yes", "? Skip it? no", "? Port? 4949"]);
  });
});
