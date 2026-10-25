import { terminalTheme } from "./terminal-theme.ts";

describe("terminalTheme", () => {
  it("reads the page-following set for studio and the fixed sets otherwise", () => {
    const read = (name: string) => (name.endsWith("bright-red") ? `${name}!` : name);
    const studio = terminalTheme("studio", read);
    expect(studio).toMatchObject({
      background: "--term-background",
      red: "--term-red",
      brightRed: "--term-bright-red!",
      brightWhite: "--term-bright-white",
      selectionBackground: "--term-selection",
    });
    expect(terminalTheme("dark", read).blue).toBe("--term-dark-blue");
    expect(terminalTheme("light", read).brightCyan).toBe("--term-light-bright-cyan");
  });
});
