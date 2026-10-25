import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import { DEFAULT_VIEW } from "../../core/views/view.ts";
import { SHORTCUTS } from "../features/routes/hooks/shortcut-registry.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup(gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW)) {
  const user = userEvent.setup();
  vi.spyOn(window, "open").mockReturnValue(null);
  const view = render(<App gateway={gateway} />);
  return { gateway, user, ...view };
}

const routeList = () => screen.findByRole("list", { name: "Routes" });

async function namesIn(list: HTMLElement): Promise<string[]> {
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector("a")?.textContent ?? "");
}

async function savedConfig(gateway: InMemoryRoutesGateway) {
  const result = await gateway.getConfig();
  if (!result.ok) throw new Error("no config");
  return result.value.config;
}

const filterButton = () => screen.getByRole("button", { name: /^Filters/ });
const filterDialog = () => screen.getByRole("dialog", { name: "Filters" });

const groupHeader = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^${name}, \\d+ routes?$`) });

afterEach(() => vi.restoreAllMocks());

describe("views: grouping", () => {
  it("groups the default view by project with a header and a count per group", async () => {
    setup();
    await routeList();

    const acme = await groupHeader("acme-monorepo");
    expect(acme.textContent).toContain("4");
    expect(acme.getAttribute("aria-expanded")).toBe("true");
    expect(await namesIn(screen.getByRole("list", { name: "acme-monorepo" }))).toEqual([
      "api.acme",
      "docs",
      "storybook",
      "web.acme",
    ]);
    expect(await namesIn(screen.getByRole("list", { name: "No project" }))).toEqual([
      "db",
      "redis",
    ]);
  });

  it("collapses a group and remembers it after a reload", async () => {
    const { user, gateway, unmount } = setup();
    await user.click(await groupHeader("acme-monorepo"));

    expect(screen.queryByRole("list", { name: "acme-monorepo" })).toBeNull();
    expect(await namesIn(await routeList())).toEqual(["db", "redis"]);

    unmount();
    setup(gateway);
    expect((await groupHeader("acme-monorepo")).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "acme-monorepo" })).toBeNull();
  });

  it("collapses and expands every group at once, by button and by [ and ]", async () => {
    const { user } = setup();
    await groupHeader("acme-monorepo");
    const expandedOf = () =>
      screen
        .getAllByRole("button", { name: /routes?$/ })
        .filter((button) => button.hasAttribute("aria-expanded"))
        .map((button) => button.getAttribute("aria-expanded"));

    await user.click(screen.getByRole("button", { name: "Collapse all groups" }));
    expect(new Set(expandedOf())).toEqual(new Set(["false"]));

    await user.click(screen.getByRole("button", { name: "Expand all groups" }));
    expect(new Set(expandedOf())).toEqual(new Set(["true"]));

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("[[");
    expect(new Set(expandedOf())).toEqual(new Set(["false"]));
    await user.keyboard("]");
    expect(new Set(expandedOf())).toEqual(new Set(["true"]));
  });

  it("walks the keyboard across groups and skips collapsed ones", async () => {
    const { user } = setup();
    await user.click(await groupHeader("acme-monorepo"));
    (document.activeElement as HTMLElement | null)?.blur();

    await user.keyboard("j");

    const row = within(screen.getByRole("list", { name: "No project" })).getAllByRole(
      "listitem",
    )[1];
    expect(row?.getAttribute("aria-current")).toBe("true");
  });
});

describe("views: favorites", () => {
  it("pins a favorite on top of every group and keeps it after a reload", async () => {
    const { user, gateway, unmount } = setup();
    await user.click(await screen.findByRole("button", { name: "Pin db to favorites" }));

    const favorites = await screen.findByRole("list", { name: "Favorites" });
    expect(await namesIn(favorites)).toEqual(["db"]);
    expect(await namesIn(screen.getByRole("list", { name: "No project" }))).toEqual(["redis"]);
    expect((await savedConfig(gateway)).favorites).toEqual(["db"]);

    unmount();
    setup(gateway);
    expect(await namesIn(await screen.findByRole("list", { name: "Favorites" }))).toEqual(["db"]);
  });

  it("toggles the selected row's favorite with f", async () => {
    const { user, gateway } = setup();
    await routeList();

    await user.keyboard("f");

    await waitFor(async () => expect((await savedConfig(gateway)).favorites).toEqual(["api.acme"]));
    await user.keyboard("f");
    await waitFor(async () => expect((await savedConfig(gateway)).favorites).toEqual([]));
  });
});

describe("views: selection", () => {
  it("keeps the selection on a route when pinning moves it to the top", async () => {
    const { user } = setup();
    await routeList();

    await user.keyboard("jjf");

    const favorites = await screen.findByRole("list", { name: "Favorites" });
    expect(within(favorites).getByRole("listitem").getAttribute("aria-current")).toBe("true");
  });

  it("selects the row selected before a reload", async () => {
    const { user, gateway, unmount } = setup();
    await routeList();
    await user.keyboard("jjj");
    unmount();

    setup(gateway);
    await routeList();
    const row = within(screen.getByRole("list", { name: "acme-monorepo" })).getAllByRole(
      "listitem",
    )[3];
    await waitFor(() => expect(row?.getAttribute("aria-current")).toBe("true"));
  });
});

describe("views: saved views", () => {
  it("saves the current grouping as a view that appears in the switcher", async () => {
    const { user, gateway } = setup();
    await routeList();

    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "kind");
    expect(window.location.search).toContain("group=kind");
    await user.click(screen.getByRole("button", { name: /^View: All \(changed\)/ }));
    await user.click(screen.getByRole("menuitem", { name: "Save as new view…" }));
    const dialog = screen.getByRole("dialog", { name: "Save as new view" });
    await user.type(within(dialog).getByLabelText("View name"), "By kind");
    await user.click(within(dialog).getByRole("button", { name: "Save view" }));

    await screen.findByRole("button", { name: /^View: By kind\./ });
    const config = await savedConfig(gateway);
    expect(config.views.map((view) => [view.id, view.name, view.groupBy])).toEqual([
      ["all", "All", "project"],
      ["by-kind", "By kind", "kind"],
    ]);
    expect(window.location.search).toBe("?view=by-kind");
    expect(await groupHeader("Apps")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^View: By kind\./ }));
    expect(
      screen.getByRole("menuitemradio", { name: "By kind" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("sets the default view, which opens when the URL names none", async () => {
    const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
    await gateway.updateConfig({
      ...DEFAULT_CONFIG,
      views: [DEFAULT_VIEW, { ...DEFAULT_VIEW, id: "flat", name: "Flat", groupBy: "none" }],
    });
    const { user, unmount } = setup(gateway);
    await routeList();

    await user.keyboard("v");
    await screen.findByRole("button", { name: /^View: Flat\./ });
    await user.keyboard("{Shift>}V{/Shift}");
    await user.click(screen.getByRole("menuitem", { name: "Set as default view" }));
    await waitFor(async () => expect((await savedConfig(gateway)).defaultViewId).toBe("flat"));

    unmount();
    window.history.replaceState(null, "", "/");
    setup(gateway);
    await screen.findByRole("button", { name: /^View: Flat\./ });
  });

  it("creates a custom group and moves routes into it", async () => {
    const { user, gateway } = setup();
    await user.click(await screen.findByRole("button", { name: "Move api.acme to a group" }));
    let dialog = screen.getByRole("dialog", { name: "Move api.acme to a group" });
    await user.type(within(dialog).getByLabelText("New group"), "Backends");
    await user.click(within(dialog).getByRole("button", { name: "Create and move" }));

    await user.click(await screen.findByRole("button", { name: "Move docs to a group" }));
    dialog = screen.getByRole("dialog", { name: "Move docs to a group" });
    await user.click(within(dialog).getByRole("button", { name: "Backends" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "custom");

    expect(await namesIn(await screen.findByRole("list", { name: "Backends" }))).toEqual([
      "api.acme",
      "docs",
    ]);
    expect((await savedConfig(gateway)).views[0]?.customGroups).toEqual([
      { id: "backends", name: "Backends", members: ["api.acme", "docs"] },
    ]);
  });
});

describe("views: filters and remembered state", () => {
  it("narrows the list from the Filter popover and writes it in the URL", async () => {
    const { user } = setup();
    await routeList();

    await user.click(filterButton());
    await user.click(within(filterDialog()).getByRole("checkbox", { name: "Aliases" }));

    expect(await namesIn(await routeList())).toEqual(["db", "redis"]);
    expect(window.location.search).toBe("?kind=alias");
    expect(screen.queryByRole("list", { name: "Detected ports" })).toBeNull();

    await user.click(within(filterDialog()).getByRole("button", { name: "Clear all" }));
    expect(await namesIn(await routeList())).toHaveLength(6);
    expect(window.location.search).toBe("");
  });

  it("restores the search and filters from the URL on load", async () => {
    window.history.replaceState(null, "", "/?q=acme&kind=app&status=up");
    const { user } = setup();

    expect(await namesIn(await routeList())).toEqual(["api.acme", "web.acme"]);
    expect(
      (screen.getByRole("searchbox", { name: "Filter routes" }) as HTMLInputElement).value,
    ).toBe("acme");
    await user.click(filterButton());
    const apps = within(filterDialog()).getByRole("checkbox", { name: "Apps" }) as HTMLInputElement;
    expect(apps.checked).toBe(true);
  });

  it("goes back to the previous filters with the browser's Back", async () => {
    const { user } = setup();
    await routeList();
    await user.click(filterButton());
    await user.click(within(filterDialog()).getByRole("checkbox", { name: "Error" }));
    expect(await namesIn(await routeList())).toEqual(["docs"]);

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });

    expect(await namesIn(await routeList())).toHaveLength(6);
  });
});

describe("filter popover", () => {
  it("opens from the Filter button and closes on a second click and on a click outside", async () => {
    const { user } = setup();
    await routeList();
    const button = filterButton();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(filterDialog().id);

    await user.click(button);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();

    await user.click(button);
    await user.click(await routeList());
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("keeps project names out of the toolbar and lists them in the popover", async () => {
    const { user } = setup();
    await routeList();
    const toolbar = filterButton().parentElement?.parentElement as HTMLElement;
    expect(within(toolbar).queryByText("acme-monorepo")).toBeNull();

    await user.click(filterButton());
    await user.click(within(filterDialog()).getByRole("checkbox", { name: "acme-monorepo" }));

    expect(await namesIn(await routeList())).toEqual(["api.acme", "docs", "storybook", "web.acme"]);
    expect(window.location.search).toBe("?project=acme-monorepo");
    await user.keyboard("{Escape}");
    expect(screen.getByText("1 filter")).toBeTruthy();
    expect(within(toolbar).queryByText("acme-monorepo")).toBeNull();
  });

  it("counts the active filters on the button and in the summary, which clears them", async () => {
    const { user } = setup();
    await routeList();
    expect(screen.queryByText(/\d filters?$/)).toBeNull();

    await user.click(filterButton());
    await user.click(within(filterDialog()).getByRole("checkbox", { name: "Apps" }));
    await user.click(within(filterDialog()).getByRole("checkbox", { name: "Up" }));

    expect(filterButton().getAttribute("aria-label")).toBe("Filters, 2 active");
    expect(filterButton().querySelector("[data-filter-count]")?.textContent).toBe("2");
    expect(screen.getByText("2 filters")).toBeTruthy();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(filterButton().getAttribute("aria-label")).toBe("Filters");
    expect(screen.queryByText("2 filters")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("moves with the arrow keys, toggles with Space and closes with Escape", async () => {
    const { user } = setup();
    await routeList();
    await user.click(filterButton());
    const dialog = filterDialog();
    const apps = within(dialog).getByRole("checkbox", { name: "Apps" });
    expect(document.activeElement).toBe(apps);

    await user.keyboard("{ArrowDown}");
    const aliases = within(dialog).getByRole("checkbox", { name: "Aliases" }) as HTMLInputElement;
    expect(document.activeElement).toBe(aliases);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(within(dialog).getAllByRole("checkbox").at(-1));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(aliases);

    await user.keyboard(" ");
    expect(aliases.checked).toBe(true);
    expect(window.location.search).toBe("?kind=alias");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(document.activeElement).toBe(filterButton());
  });

  it("opens with Shift+F while f still pins the selected route", async () => {
    const { user, gateway } = setup();
    await routeList();

    await user.keyboard("f");
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    await waitFor(async () => expect((await savedConfig(gateway)).favorites).toContain("api.acme"));

    await user.keyboard("F");
    expect(filterDialog()).toBeTruthy();
  });

  it("opens from the command menu", async () => {
    const { user } = setup();
    await routeList();

    await user.keyboard("{Control>}k{/Control}");
    const option = screen
      .getAllByRole("option")
      .find((item) => item.textContent?.includes("Open filters"));
    expect(option?.textContent).toContain("Shift F");
    await user.click(option as HTMLElement);

    expect(filterDialog()).toBeTruthy();
  });
});

describe("shortcuts", () => {
  it("lists every shortcut of the registry when you press ?", async () => {
    const { user } = setup();
    await routeList();

    await user.keyboard("?");

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const group of ["Navigation", "Actions", "Views", "App"]) {
      expect(within(dialog).getByRole("heading", { name: group })).toBeTruthy();
    }
    const listed = [...dialog.querySelectorAll("[data-shortcut]")].map((item) =>
      item.getAttribute("data-shortcut"),
    );
    expect(listed).toEqual(SHORTCUTS.map((item) => item.id));
  });

  it("offers the view, favorite, filter and app actions in the command menu", async () => {
    const { user } = setup();
    await routeList();

    await user.keyboard("{Control>}k{/Control}");

    const options = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    for (const label of [
      "Pin api.acme to favorites",
      "Move api.acme to a group…",
      "Stop the server of api.acme…",
      "Save as new view…",
      "Filter by kind: Aliases",
      "Open health panel",
      "Stop proxy",
      "Open settings",
      "Show keyboard shortcuts",
      "Toggle theme",
      "Stop Studio…",
    ]) {
      expect(options.some((text) => text.includes(label))).toBe(true);
    }
  });
});
