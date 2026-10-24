import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { InMemoryTerminalsGateway, type TerminalEngine } from "../features/terminals/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const FALCON = "/home/dev/code/acme-falcon";

/** Stands in for xterm.js, which needs a real browser: records what it is given. */
function fakeEngine() {
  const screens: { written: string[]; type(text: string): void; disposed: boolean }[] = [];
  const engine: TerminalEngine = {
    createTerminal: () => {
      let onData: (text: string) => void = () => {};
      const screen = {
        written: [] as string[],
        disposed: false,
        type: (text: string) => onData(text),
      };
      screens.push(screen);
      const terminal = {
        options: {},
        loadAddon: () => {},
        open: () => {},
        write: (text: string) => screen.written.push(text),
        scrollToBottom: () => {},
        onData: (listener: (text: string) => void) => {
          onData = listener;
          return { dispose: () => {} };
        },
        dispose: () => {
          screen.disposed = true;
        },
      };
      return terminal as unknown as ReturnType<TerminalEngine["createTerminal"]>;
    },
    createFit: () => ({ fit: () => {} }) as unknown as ReturnType<TerminalEngine["createFit"]>,
  };
  return { engine, screens };
}

function setup() {
  const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
  const terminals = new InMemoryTerminalsGateway(() => NOW);
  const { engine, screens } = fakeEngine();
  const user = userEvent.setup();
  const view = render(
    <App gateway={gateway} terminals={terminals} loadTerminalEngine={async () => engine} />,
  );
  return { gateway, terminals, screens, user, view };
}

async function routeRow(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Routes" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("a")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

const panel = () => screen.findByRole("region", { name: "Terminals" });

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("terminal panel", () => {
  it("opens a shell in a row's folder from the row menu and shows its output", async () => {
    const { terminals, screens } = setup();
    fireEvent.contextMenu(await routeRow("storybook"), { clientX: 40, clientY: 60 });
    const menu = await screen.findByRole("menu", { name: /Actions for/ });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open terminal" }));

    const terminalsPanel = await panel();
    expect(terminals.created).toEqual([{ cwd: FALCON }]);
    expect(within(terminalsPanel).getByRole("tab", { name: "shell" })).toBeTruthy();
    await waitFor(() => expect(screens[0]?.written.join("")).toContain("$ "));
    act(() => terminals.write("t1", "hello\r\n"));
    expect(screens[0]?.written.join("")).toContain("hello");
  });

  it("opens the running terminal of a folder again instead of a new one", async () => {
    const { terminals, user } = setup();
    await terminals.create({ cwd: FALCON, command: "pnpm dev" });
    const row = await routeRow("storybook");
    await user.click(row);
    await user.keyboard("t");
    const terminalsPanel = await panel();
    expect(terminals.created).toHaveLength(1);
    expect(
      within(terminalsPanel).getByRole("tab", { name: "pnpm dev" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("sends what is typed to the command", async () => {
    const { terminals, screens } = setup();
    await act(() => terminals.create({ cwd: FALCON, command: "node repl.js" }));
    fireEvent.click(screen.getByRole("button", { name: /Show terminals/ }));
    await waitFor(() => expect(screens).toHaveLength(1));
    act(() => screens[0]?.type("1+1\r"));
    await waitFor(() => expect(terminals.inputs).toEqual([{ id: "t1", text: "1+1\r" }]));
  });

  it("stops and restarts the command and shows the exit code", async () => {
    const { terminals, user } = setup();
    await act(() => terminals.create({ cwd: FALCON, command: "pnpm dev" }));
    await user.click(screen.getByRole("button", { name: /Show terminals/ }));
    const terminalsPanel = await panel();
    expect(within(terminalsPanel).getByText("Running")).toBeTruthy();
    await user.click(within(terminalsPanel).getByRole("button", { name: "Stop" }));
    expect(await within(terminalsPanel).findByText("Exited with code 130")).toBeTruthy();
    await user.click(within(terminalsPanel).getByRole("button", { name: "Run again" }));
    expect(await within(terminalsPanel).findByText("Running")).toBeTruthy();
  });

  it("starts a command in a project folder from New terminal", async () => {
    const { terminals, user } = setup();
    await user.click(await screen.findByRole("button", { name: /Show terminals/ }));
    const form = await screen.findByRole("form", { name: "New terminal" });
    await user.selectOptions(within(form).getByLabelText("Project folder"), FALCON);
    await user.type(within(form).getByLabelText("Command"), "pnpm test");
    await user.click(within(form).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(terminals.created).toEqual([{ cwd: FALCON, command: "pnpm test" }]));
    expect(await within(await panel()).findByRole("tab", { name: "pnpm test" })).toBeTruthy();
  });

  it("groups tabs by project and closes them", async () => {
    const { terminals, user } = setup();
    await act(async () => {
      await terminals.create({ cwd: FALCON, command: "pnpm dev", project: "acme" });
      await terminals.create({ cwd: "/home/dev/code/shop", command: "pnpm dev", project: "shop" });
    });
    await user.click(screen.getByRole("button", { name: /Show terminals/ }));
    const terminalsPanel = await panel();
    expect(within(terminalsPanel).getByText("acme")).toBeTruthy();
    expect(within(terminalsPanel).getByText("shop")).toBeTruthy();
    await user.click(
      within(terminalsPanel).getAllByRole("button", { name: "Close pnpm dev" })[0] as HTMLElement,
    );
    await waitFor(() => expect(within(terminalsPanel).getAllByRole("tab")).toHaveLength(1));
  });

  it("remembers its dock and size", async () => {
    const { user, view } = setup();
    await user.click(await screen.findByRole("button", { name: /Show terminals/ }));
    const handle = await screen.findByRole("separator", { name: "Resize the terminal panel" });
    handle.focus();
    await user.keyboard("{ArrowUp}");
    await user.click(screen.getByRole("button", { name: "Dock on the right" }));
    view.unmount();
    setup();
    const again = await panel();
    expect(again.getAttribute("data-dock")).toBe("right");
    expect(again.style.getPropertyValue("--panel-size")).toBe("344px");
  });
});

describe("focus requests", () => {
  it("shows the terminal a request names and tells Studio whether the window came forward", async () => {
    const { gateway, terminals } = setup();
    await act(() => terminals.create({ cwd: FALCON, command: "pnpm dev" }));
    await screen.findByRole("list", { name: "Routes" });
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => gateway.focus({ id: "f1", target: { terminal: "t1" } }));
    const terminalsPanel = await panel();
    expect(within(terminalsPanel).getByRole("tab", { name: "pnpm dev" })).toBeTruthy();
    expect(focus).toHaveBeenCalled();
    await waitFor(() => expect(gateway.focusAcks).toEqual([{ id: "f1", focused: true }]));
  });

  it("selects the route a request names", async () => {
    const { gateway } = setup();
    await screen.findByRole("list", { name: "Routes" });
    vi.spyOn(window, "focus").mockImplementation(() => {});
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => gateway.focus({ id: "f2", target: { route: "storybook" } }));
    await waitFor(async () =>
      expect((await routeRow("storybook")).getAttribute("aria-current")).toBe("true"),
    );
    await waitFor(() => expect(gateway.focusAcks).toEqual([{ id: "f2", focused: false }]));
  });

  it("opens the terminal named in the link Studio opened", async () => {
    window.history.replaceState(null, "", "/?terminal=t1");
    const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
    const terminals = new InMemoryTerminalsGateway(() => NOW);
    await terminals.create({ cwd: FALCON, command: "pnpm dev" });
    render(
      <App
        gateway={gateway}
        terminals={terminals}
        loadTerminalEngine={async () => fakeEngine().engine}
      />,
    );
    const terminalsPanel = await panel();
    expect(within(terminalsPanel).getByRole("tab", { name: "pnpm dev" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("waits for a terminal the list does not show yet instead of switching away", async () => {
    window.history.replaceState(null, "", "/?terminal=t2");
    const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
    const terminals = new InMemoryTerminalsGateway(() => NOW);
    await terminals.create({ cwd: FALCON, command: "pnpm dev" });
    render(
      <App
        gateway={gateway}
        terminals={terminals}
        loadTerminalEngine={async () => fakeEngine().engine}
      />,
    );
    const terminalsPanel = await panel();
    await act(() => terminals.create({ cwd: FALCON, command: "pnpm test" }));
    await waitFor(() =>
      expect(
        within(terminalsPanel)
          .getByRole("tab", { name: "pnpm test" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });
});
