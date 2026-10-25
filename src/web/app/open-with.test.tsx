import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "../../core/api/contract.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const FALCON = "/home/dev/code/acme-falcon";

function setup(snapshot: Snapshot = createSampleSnapshot(NOW)) {
  const gateway = new InMemoryRoutesGateway(snapshot, () => NOW);
  const user = userEvent.setup();
  render(<App gateway={gateway} />);
  return { gateway, user };
}

async function routeRow(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Routes" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("a")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

const menu = () => screen.findByRole("menu", { name: /Actions for/ });

afterEach(() => vi.restoreAllMocks());

describe("where each row runs", () => {
  it("shows the branch, the worktree and the short folder under the URL", async () => {
    setup();
    const row = await routeRow("storybook");
    const location = within(row).getByLabelText("Where it runs");
    expect(location.textContent).toContain("fix/dark-mode");
    expect(location.textContent).toContain("falcon");
    expect(within(location).getByTitle(FALCON).textContent).toBe("~/code/acme-falcon");
  });

  it("shows the branch of a detected port next to its folder", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Detected ports" });
    const row = list.querySelector('[data-port="4209"]') as HTMLElement;
    expect(within(row).getByLabelText("Where it runs").textContent).toContain("feat/SHOP-7-orders");
  });

  it("shows nothing extra for a route with no known folder", async () => {
    setup();
    expect(within(await routeRow("db")).queryByLabelText("Where it runs")).toBeNull();
  });
});

describe("row menu", () => {
  it("opens on right-click with the editors the server found", async () => {
    const { user } = setup();
    fireEvent.contextMenu(await routeRow("storybook"), { clientX: 40, clientY: 60 });

    const actions = await menu();
    expect(
      within(actions)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Open in browser",
      "Copy URL",
      "Open direct URL",
      "Copy direct URL",
      "Copy as .env line",
      "Copy path",
      "Open terminal",
      "Reveal in File manager",
      "Open with",
    ]);
    await user.click(within(actions).getByRole("menuitem", { name: "Open with" }));
    const editors = await screen.findByRole("menu", { name: "Open with" });
    expect(
      within(editors)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["VS Code", "Zed", "Customize apps…"]);
  });

  it("opens the folder in the chosen editor", async () => {
    const { gateway, user } = setup();
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open with" }));
    await user.click(await screen.findByRole("menuitem", { name: "Zed" }));

    await waitFor(() => expect(gateway.openedWith).toEqual([{ appId: "zed", path: FALCON }]));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on Ctrl+click and reveals the folder in the file manager", async () => {
    const { gateway, user } = setup();
    const row = await routeRow("storybook");
    await user.keyboard("{Control>}");
    await user.click(within(row).getByText("storybook.localhost:1355"));
    await user.keyboard("{/Control}");
    await user.click(
      within(await menu()).getByRole("menuitem", { name: "Reveal in File manager" }),
    );

    await waitFor(() =>
      expect(gateway.openedWith).toEqual([{ appId: "file-manager", path: FALCON }]),
    );
  });

  it("opens from the keyboard on the selected row, moves with arrows and closes with Esc", async () => {
    const { user } = setup();
    await user.click(within(await routeRow("storybook")).getByText("storybook.localhost:1355"));
    await user.keyboard(".");
    expect((await menu()).getAttribute("aria-label")).toBe("Actions for storybook");
    const actions = await menu();
    expect(document.activeElement?.textContent).toBe("Open in browser");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Copy URL");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("Open with");
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menu", { name: "Open with" })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("VS Code");
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menu", { name: "Open with" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(actions.isConnected).toBe(false);

    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await menu()).toBeTruthy();
  });

  it("copies the folder path and the URL", async () => {
    const { user } = setup();
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Copy path" }));
    expect(await navigator.clipboard.readText()).toBe(FALCON);

    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Copy URL" }));
    expect(await navigator.clipboard.readText()).toBe("http://storybook.localhost:1355");
  });

  it("opens the route in the browser", async () => {
    const { user } = setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open in browser" }));
    expect(open).toHaveBeenCalledWith(
      "http://storybook.localhost:1355",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("offers only the URL actions for a route with no known folder", async () => {
    setup();
    fireEvent.contextMenu(await routeRow("db"));
    const actions = await menu();
    expect(
      within(actions)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Open in browser",
      "Copy URL",
      "Open direct URL",
      "Copy direct URL",
      "Copy as .env line",
    ]);
  });

  it("works on detected ports with their folder", async () => {
    const { gateway, user } = setup();
    const list = await screen.findByRole("list", { name: "Detected ports" });
    fireEvent.contextMenu(list.querySelector('[data-port="5173"]') as HTMLElement);
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open with" }));
    await user.click(await screen.findByRole("menuitem", { name: "VS Code" }));

    await waitFor(() =>
      expect(gateway.openedWith).toEqual([{ appId: "vscode", path: "/home/dev/code/acme" }]),
    );
  });

  it("stays inside a narrow viewport", async () => {
    setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    try {
      fireEvent.contextMenu(await routeRow("storybook"), { clientX: 350, clientY: 20 });
      const actions = await menu();
      const left = Number.parseFloat(actions.style.left);
      expect(left).toBeLessThanOrEqual(360 - 8);
      expect(left).toBeGreaterThanOrEqual(8);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    }
  });
});

describe("custom apps", () => {
  it("adds an app in Settings and lists it under Open with", async () => {
    const { gateway, user } = setup();
    await routeRow("storybook");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(await within(dialog).findByRole("button", { name: "Add an app" }));
    await user.type(within(dialog).getByLabelText("Name of app 1"), "Helix");
    await user.type(within(dialog).getByLabelText("Command of app 1"), "foot hx {{path}");
    await user.click(within(dialog).getByRole("button", { name: "Save apps" }));
    await within(dialog).findByText("Saved");
    expect((await gateway.getCustomApps()).ok && gateway.customApps).toEqual([
      { name: "Helix", command: "foot hx {path}" },
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open with" }));
    await user.click(await screen.findByRole("menuitem", { name: "Helix" }));
    await waitFor(() => expect(gateway.openedWith).toEqual([{ appId: "custom-1", path: FALCON }]));
  });

  it("shows why a command is rejected", async () => {
    const { user } = setup();
    await routeRow("storybook");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(await within(dialog).findByRole("button", { name: "Add an app" }));
    await user.type(within(dialog).getByLabelText("Name of app 1"), "Broken");
    await user.type(within(dialog).getByLabelText("Command of app 1"), 'vim "x');
    await user.click(within(dialog).getByRole("button", { name: "Save apps" }));
    expect(
      (await within(dialog).findByText(/A quote in the command is not closed/)).textContent,
    ).toBe("Broken: A quote in the command is not closed.");
  });

  it("opens Settings from Customize apps", async () => {
    const { user } = setup();
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open with" }));
    await user.click(await screen.findByRole("menuitem", { name: "Customize apps…" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
  });
});
