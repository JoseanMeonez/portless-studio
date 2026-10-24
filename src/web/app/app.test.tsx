import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiError, Snapshot } from "../../core/api/contract.ts";
import { err } from "../../core/result.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup(snapshot: Snapshot = createSampleSnapshot(NOW)) {
  const gateway = new InMemoryRoutesGateway(snapshot, () => NOW);
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<App gateway={gateway} />);
  return { gateway, user, open };
}

const routeList = () => screen.findByRole("list", { name: "Routes" });

async function routeNames(): Promise<string[]> {
  const rows = within(await routeList()).getAllByRole("listitem");
  return rows.map((row) => row.querySelector("a")?.textContent ?? "");
}

const rowOf = async (name: string) => {
  const rows = within(await routeList()).getAllByRole("listitem");
  const row = rows.find((item) => item.querySelector("a")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

afterEach(() => vi.restoreAllMocks());

describe("routes list", () => {
  it("shows apps first and then aliases, each in alphabetical order", async () => {
    setup();
    expect(await routeNames()).toEqual([
      "api.acme",
      "docs",
      "storybook",
      "web.acme",
      "db",
      "redis",
    ]);
  });

  it("narrows the list as you type in the filter and shows the count", async () => {
    const { user } = setup();
    await routeList();
    expect(screen.getByText("6 routes")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "Filter routes" }), "acme");

    expect(await routeNames()).toEqual(["api.acme", "web.acme"]);
    expect(screen.getByText("2 of 6")).toBeTruthy();
  });

  it("focuses the filter when you press /", async () => {
    const { user } = setup();
    await routeList();

    await user.keyboard("/");

    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Filter routes" }));
  });

  it("moves the selection with j and k and opens the selected route with Enter", async () => {
    const { user, open } = setup();
    await routeList();

    await user.keyboard("jjk{Enter}");

    expect((await rowOf("docs")).getAttribute("aria-current")).toBe("true");
    expect(open).toHaveBeenCalledWith("https://docs.localhost", "_blank", "noopener,noreferrer");
  });

  it("updates the list when the server sends a new snapshot", async () => {
    const { gateway } = setup();
    await routeList();
    const snapshot = createSampleSnapshot(NOW);
    const extra = { ...snapshot.routes[0], name: "admin", hostname: "admin.localhost" };

    act(() =>
      gateway.emit({ ...snapshot, routes: [...snapshot.routes, extra] as Snapshot["routes"] }),
    );

    expect(await routeNames()).toContain("admin");
  });
});

describe("Name a port dialog", () => {
  it("explains an invalid name and keeps the submit button disabled", async () => {
    const { user } = setup();
    await routeList();
    await user.click(screen.getByRole("button", { name: "Name a port" }));
    const dialog = screen.getByRole("dialog", { name: "Name a port" });

    await user.type(within(dialog).getByLabelText("Name"), "bad_name!");
    await user.type(within(dialog).getByLabelText("Port"), "6380");

    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Use letters, numbers and hyphens",
    );
    expect(within(dialog).getByRole("button", { name: "Name port" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("creates the alias, closes and confirms with a toast", async () => {
    const { user, gateway } = setup();
    const createAlias = vi.spyOn(gateway, "createAlias");
    await routeList();
    await user.keyboard("n");
    const dialog = screen.getByRole("dialog", { name: "Name a port" });

    await user.type(within(dialog).getByLabelText("Name"), "cache");
    await user.type(within(dialog).getByLabelText("Port"), "6380");
    expect(within(dialog).getByText("https://cache.localhost")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Name port" }));

    expect(createAlias).toHaveBeenCalledWith({ name: "cache", port: 6380 });
    expect(await screen.findByText("Named port 6380")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await routeNames()).toContain("cache");
  });

  it("offers to replace a route when the name is taken", async () => {
    const { user, gateway } = setup();
    const createAlias = vi.spyOn(gateway, "createAlias");
    await routeList();
    await user.click(screen.getByRole("button", { name: "Name a port" }));
    const dialog = screen.getByRole("dialog", { name: "Name a port" });

    await user.type(within(dialog).getByLabelText("Name"), "db");
    await user.type(within(dialog).getByLabelText("Port"), "5433");
    await user.click(within(dialog).getByRole("button", { name: "Name port" }));
    await user.click(await within(dialog).findByRole("button", { name: "Replace" }));

    expect(createAlias).toHaveBeenLastCalledWith({ name: "db", port: 5433, force: true });
    expect((await rowOf("db")).textContent).toContain(":5433");
  });

  it("closes with Escape and gives focus back to the button that opened it", async () => {
    const { user } = setup();
    await routeList();
    const opener = screen.getByRole("button", { name: "Name a port" });
    await user.click(opener);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("removing aliases", () => {
  it("offers Remove only on aliases and asks before removing", async () => {
    const { user } = setup();
    expect(within(await rowOf("docs")).queryByRole("button", { name: "Remove docs" })).toBeNull();

    await user.click(within(await rowOf("db")).getByRole("button", { name: "Remove db" }));
    expect(screen.getByText("Remove db?")).toBeTruthy();
    await user.click(within(await rowOf("db")).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Removed db")).toBeTruthy();
    expect(await routeNames()).not.toContain("db");
  });
});

describe("command menu", () => {
  it("opens with Ctrl+K and opens the route you pick", async () => {
    const { user, open } = setup();
    await routeList();

    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "storybook");
    await user.keyboard("{Enter}");

    expect(open).toHaveBeenCalledWith(
      "https://storybook.localhost",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("dialog", { name: "Command menu" })).toBeNull();
  });
});

describe("other states", () => {
  it("teaches how to add a route when there are none", async () => {
    setup({ ...createSampleSnapshot(NOW), routes: [] });

    expect(await screen.findByText("No routes yet")).toBeTruthy();
    expect(screen.getByText("portless myapp pnpm dev")).toBeTruthy();
    expect(screen.getByText("portless alias db 5432")).toBeTruthy();
  });

  it("warns when the proxy is not running", async () => {
    const snapshot = createSampleSnapshot(NOW);
    setup({ ...snapshot, proxy: { ...snapshot.proxy, running: false } });

    expect(await screen.findByText("The portless proxy is not running.")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("shows an error with a retry when the server cannot be reached", async () => {
    const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW));
    const failure: ApiError = { error: "internal", message: "Could not reach the server." };
    vi.spyOn(gateway, "getSnapshot").mockResolvedValue(err(failure));
    vi.spyOn(gateway, "subscribe").mockReturnValue(() => {});
    render(<App gateway={gateway} />);

    expect(await screen.findByText("Can’t reach the studio server")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("portless install", () => {
  const missing = (): Snapshot => ({
    ...createSampleSnapshot(NOW),
    portless: { installed: false, version: null },
  });

  function setupMissing(outcome: "success" | "failure") {
    const gateway = new InMemoryRoutesGateway(missing(), () => NOW, {
      installDelayMs: 30,
      installOutcome: outcome,
    });
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    return { gateway, user };
  }

  it("explains that portless is missing instead of the proxy warning", async () => {
    const snapshot = missing();
    setup({ ...snapshot, proxy: { ...snapshot.proxy, running: false } });

    expect(await screen.findByText("portless is not installed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install portless" })).toBeTruthy();
    expect(screen.getByText("npm install -g portless")).toBeTruthy();
    expect(screen.queryByText("The portless proxy is not running.")).toBeNull();
  });

  it("shows progress, then a success toast, and the banner goes away", async () => {
    const { user } = setupMissing("success");
    await user.click(await screen.findByRole("button", { name: "Install portless" }));

    const busy = screen.getByRole("button", { name: "Installing…" });
    expect(busy.hasAttribute("disabled")).toBe(true);

    expect(await screen.findByText("portless 0.4.2 installed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("portless is not installed")).toBeNull());
  });

  it("shows npm's output and the manual command when the install fails", async () => {
    const { user } = setupMissing("failure");
    await user.click(await screen.findByRole("button", { name: "Install portless" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("npm error code EACCES");
    expect(screen.getByText("npm install -g portless")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install portless" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("does not mention installing when portless is installed", async () => {
    setup();
    await routeList();
    expect(screen.queryByText("portless is not installed")).toBeNull();
  });
});
