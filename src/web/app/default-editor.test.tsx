import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OpenWithApp } from "../../core/api/contract.ts";
import { ok } from "../../core/result.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const FALCON = "/home/dev/code/acme-falcon";

function setup() {
  const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
  const user = userEvent.setup();
  return { gateway, user, start: () => render(<App gateway={gateway} />) };
}

async function routeRow(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Routes" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("a")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

afterEach(() => vi.restoreAllMocks());

describe("default editor button", () => {
  it("opens a route's folder in the first editor found, named in its tooltip", async () => {
    const { gateway, user, start } = setup();
    start();
    const button = await within(await routeRow("storybook")).findByRole("button", {
      name: "Open storybook in VS Code",
    });
    expect(button.getAttribute("title")).toBe("Open in VS Code");
    await user.click(button);
    await waitFor(() => expect(gateway.openedWith).toEqual([{ appId: "vscode", path: FALCON }]));
  });

  it("uses the default editor chosen in the config", async () => {
    const { gateway, user, start } = setup();
    const config = await gateway.getConfig();
    if (!config.ok) throw new Error("no config");
    await gateway.updateConfig({ ...config.value.config, defaultEditor: "zed" });
    start();
    await user.click(
      await within(await routeRow("storybook")).findByRole("button", {
        name: "Open storybook in Zed",
      }),
    );
    await waitFor(() => expect(gateway.openedWith).toEqual([{ appId: "zed", path: FALCON }]));
  });

  it("opens a detected port's folder too", async () => {
    const { gateway, user, start } = setup();
    start();
    const list = await screen.findByRole("list", { name: "Detected ports" });
    const row = list.querySelector('[data-port="5173"]') as HTMLElement;
    await user.click(await within(row).findByRole("button", { name: "Open port 5173 in VS Code" }));
    await waitFor(() =>
      expect(gateway.openedWith).toEqual([{ appId: "vscode", path: "/home/dev/code/acme" }]),
    );
  });

  it("is hidden for a route with no known folder", async () => {
    const { start } = setup();
    start();
    await within(await routeRow("storybook")).findByRole("button", { name: /in VS Code/ });
    expect(within(await routeRow("db")).queryByRole("button", { name: /Open db in/ })).toBeNull();
  });

  it("is hidden when no editor is found on this machine", async () => {
    const { gateway, start } = setup();
    const apps: OpenWithApp[] = [{ id: "file-manager", name: "Files", kind: "file-manager" }];
    vi.spyOn(gateway, "listOpenWithApps").mockResolvedValue(ok(apps));
    start();
    const row = await routeRow("storybook");
    await waitFor(() => expect(gateway.listOpenWithApps).toHaveBeenCalled());
    expect(within(row).queryByRole("button", { name: /Open storybook in/ })).toBeNull();
  });
});

describe("Default editor setting", () => {
  it("lists the editors found and the custom apps, and saves the choice", async () => {
    const { gateway, user, start } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    start();
    await screen.findByRole("list", { name: "Routes" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const select = (await within(dialog).findByLabelText("Default editor")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "First editor found (VS Code)",
      "VS Code",
      "Zed",
    ]);
    await user.selectOptions(select, "zed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ defaultEditor: "zed" }));
    expect(
      await within(await routeRow("storybook")).findByRole("button", {
        name: "Open storybook in Zed",
      }),
    ).toBeTruthy();
  });
});

describe("uptime column", () => {
  // The page counts uptimes to the browser clock; pin it to the sample's time.
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));

  it("counts from the process start, says down for a closed port and explains it", async () => {
    const { start } = setup();
    start();
    const storybook = (await routeRow("storybook")).querySelector('[data-cell="uptime"]');
    // Named 3 days ago, but the process listening now started 5 h 2 min ago.
    expect(storybook?.textContent).toBe("up 5h 2m");
    expect(storybook?.getAttribute("title")).toMatch(/^Running since /);
    const db = (await routeRow("db")).querySelector('[data-cell="uptime"]');
    expect(db?.textContent).toBe("down");
    expect(db?.getAttribute("title")).toBe("Nothing answers on :5432\nNamed 9d ago");
  });

  it("shows how long a detected port's process has run", async () => {
    const { start } = setup();
    start();
    const list = await screen.findByRole("list", { name: "Detected ports" });
    const row = list.querySelector('[data-port="4321"]') as HTMLElement;
    expect(row.querySelector('[data-cell="uptime"]')?.textContent).toBe("up 3h 5m");
  });
});
