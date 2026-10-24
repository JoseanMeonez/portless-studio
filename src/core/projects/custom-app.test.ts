import { commandFor, parseCustomApps, splitCommand } from "./custom-app.ts";

describe("splitCommand", () => {
  it("splits on spaces and keeps quoted words together, with no shell rules", () => {
    expect(splitCommand(`kitty --title "my editor" 'a b' C:\\Tools\\x.exe $HOME;rm`)).toEqual({
      ok: true,
      value: ["kitty", "--title", "my editor", "a b", "C:\\Tools\\x.exe", "$HOME;rm"],
    });
    expect(splitCommand(`say ""`)).toEqual({ ok: true, value: ["say", ""] });
  });

  it("fails on an empty command or an unclosed quote", () => {
    expect(splitCommand("   ").ok).toBe(false);
    expect(splitCommand(`code "open`)).toEqual({
      ok: false,
      error: "A quote in the command is not closed.",
    });
  });
});

describe("commandFor", () => {
  it("puts the folder where {path} is, as one argument even with spaces", () => {
    expect(commandFor("kitty --directory={path} nvim", "/home/dev/my app")).toEqual({
      ok: true,
      value: { file: "kitty", args: ["--directory=/home/dev/my app", "nvim"] },
    });
  });

  it("adds the folder last when there is no {path}", () => {
    expect(commandFor(`"/opt/My Editor/editor" --new-window`, "/srv/acme")).toEqual({
      ok: true,
      value: { file: "/opt/My Editor/editor", args: ["--new-window", "/srv/acme"] },
    });
  });

  it("keeps characters a shell would read as they are", () => {
    const folder = "/srv/$(touch x);a";
    expect(commandFor("subl {path}", folder)).toEqual({
      ok: true,
      value: { file: "subl", args: [folder] },
    });
  });

  it("refuses a command that starts with {path}", () => {
    expect(commandFor("{path} --x", "/srv").ok).toBe(false);
  });
});

describe("parseCustomApps", () => {
  it("trims names and commands", () => {
    expect(parseCustomApps([{ name: " Neovim ", command: " kitty nvim {path} " }])).toEqual({
      ok: true,
      value: [{ name: "Neovim", command: "kitty nvim {path}" }],
    });
  });

  it("names the entry it rejects", () => {
    expect(parseCustomApps("x")).toEqual({ ok: false, error: "Custom apps must be a list." });
    expect(parseCustomApps([{ name: "", command: "x" }])).toEqual({
      ok: false,
      error: "App 1 needs a name of 1 to 40 characters.",
    });
    expect(parseCustomApps([{ name: "Vim", command: `vim "x` }])).toEqual({
      ok: false,
      error: "Vim: A quote in the command is not closed.",
    });
    expect(
      parseCustomApps([
        { name: "Vim", command: "vim" },
        { name: "vim", command: "gvim" },
      ]),
    ).toEqual({ ok: false, error: "Two apps are called vim." });
  });
});
