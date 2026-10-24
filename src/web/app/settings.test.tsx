import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { err } from "../../core/result.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup() {
  const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
  const user = userEvent.setup();
  render(<App gateway={gateway} />);
  return { gateway, user };
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("list", { name: "Routes" });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  await within(dialog).findByText("~/.portless-studio/config.json");
  return dialog;
}

afterEach(() => vi.restoreAllMocks());

describe("settings", () => {
  it("loads the config and shows where its file lives", async () => {
    const { user } = setup();
    const dialog = await openSettings(user);

    expect((within(dialog).getByLabelText("Scan interval") as HTMLInputElement).value).toBe("3");
    expect((within(dialog).getByLabelText("Studio port") as HTMLInputElement).value).toBe("4949");
    expect(
      within(dialog)
        .getByRole("switch", { name: "Open the browser on start" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(dialog).getByText("Takes effect after restarting Studio.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copy config path" })).toBeTruthy();
  });

  it("saves edited values, confirms and closes", async () => {
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);

    await user.click(within(dialog).getByRole("switch", { name: "Open the browser on start" }));
    const interval = within(dialog).getByLabelText("Scan interval");
    await user.clear(interval);
    await user.type(interval, "5");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ openBrowser: false, scanIntervalMs: 5000 }),
    );
    expect(await screen.findByText("Settings saved")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("edits the proxy settings, HTTP on 1355 by default", async () => {
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);

    const proxyPort = within(dialog).getByLabelText("Proxy port") as HTMLInputElement;
    expect(proxyPort.value).toBe("1355");
    const https = within(dialog).getByRole("switch", { name: "Use HTTPS" });
    expect(https.getAttribute("aria-checked")).toBe("false");

    await user.clear(proxyPort);
    await user.type(proxyPort, "8443");
    await user.click(https);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ startProxy: true, proxyPort: 8443, proxyHttps: true }),
    );
  });

  it("shows the server's invalid_config message next to the field it names", async () => {
    const { user, gateway } = setup();
    vi.spyOn(gateway, "updateConfig").mockResolvedValue(
      err({ error: "invalid_config", message: `"port" must be a whole number from 1 to 65535.` }),
    );
    const dialog = await openSettings(user);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const port = within(dialog).getByLabelText("Studio port");
    expect(port.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByRole("alert").textContent).toContain(
      '"port" must be a whole number',
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("adds and removes ignored ports as chips", async () => {
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);
    const input = within(dialog).getByLabelText("Ignored ports");

    await user.type(input, "abc{Enter}");
    expect(within(dialog).getByRole("alert").textContent).toContain("port number");
    await user.clear(input);
    await user.type(input, "9229{Enter}");
    await user.type(input, "6000{Enter}");
    expect(within(dialog).getByRole("button", { name: "Remove 9229" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Remove 6000" }));
    expect(within(dialog).queryByRole("button", { name: "Remove 6000" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ ignoredPorts: [9229] }));
  });

  it("opens with the comma key and from the command menu", async () => {
    const { user } = setup();
    await screen.findByRole("list", { name: "Routes" });

    await user.keyboard(",");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "settings");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });
});

describe("notification settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the browser for permission when desktop notifications are turned on and saves both switches and the auto-removal minutes", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);

    expect(within(dialog).getByText(/needs a Studio tab open/)).toBeTruthy();
    await user.click(within(dialog).getByRole("switch", { name: "Desktop notifications" }));
    expect(requestPermission).toHaveBeenCalled();
    await user.click(within(dialog).getByRole("switch", { name: "System notifications" }));
    const minutes = within(dialog).getByLabelText("Remove auto names after");
    expect((minutes as HTMLInputElement).value).toBe("10");
    await user.clear(minutes);
    await user.type(minutes, "0");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        desktopNotifications: true,
        systemNotifications: true,
        autoRemoveAfterMinutes: 0,
      }),
    );
  });

  it("leaves desktop notifications off when the browser denies permission", async () => {
    const requestPermission = vi.fn(async () => "denied" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const { user } = setup();
    const dialog = await openSettings(user);

    const toggle = within(dialog).getByRole("switch", { name: "Desktop notifications" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(await within(dialog).findByText(/blocked notifications/)).toBeTruthy();
  });

  it("rejects a negative number of minutes", async () => {
    const { user } = setup();
    const dialog = await openSettings(user);
    const minutes = within(dialog).getByLabelText("Remove auto names after");
    await user.clear(minutes);
    await user.type(minutes, "-3");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Use a whole number of minutes, 0 or more.")).toBeTruthy();
  });
});

describe("project icons", () => {
  const routeRow = async (name: string) => {
    const list = await screen.findByRole("list", { name: "Routes" });
    const row = within(list)
      .getAllByRole("listitem")
      .find((item) => item.querySelector("a")?.textContent === name);
    if (!row) throw new Error(`no row ${name}`);
    return row;
  };

  it("shows a monogram for a project without an icon", async () => {
    setup();
    const row = await routeRow("web.acme");
    expect(row.querySelector("[data-monogram]")?.textContent).toBe("AM");
  });

  it("sets an emoji for a known project, saves it and shows it on its rows", async () => {
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);

    within(dialog).getByRole("group", { name: "Project icons" });
    const field = within(dialog).getByLabelText("Icon for acme-monorepo");
    await user.type(field, "🦊");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ projectIcons: { "acme-monorepo": "🦊" } }),
    );
    await waitFor(async () => expect((await routeRow("web.acme")).textContent).toContain("🦊"));
  });

  it("clears an icon", async () => {
    const { user, gateway } = setup();
    const config = await gateway.getConfig();
    if (!config.ok) throw new Error("no config");
    await gateway.updateConfig({ ...config.value.config, projectIcons: { "shop-admin": "🦦" } });
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    const dialog = await openSettings(user);

    await user.click(within(dialog).getByRole("button", { name: "Clear the icon of shop-admin" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ projectIcons: {} }));
  });

  it("explains a value that cannot be an icon", async () => {
    const { user } = setup();
    const dialog = await openSettings(user);
    await user.type(within(dialog).getByLabelText("Icon for shop-admin"), "not an icon at all");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      within(dialog).getByText(/shop-admin.*emoji, an http\(s\) URL or a data:image URL/),
    ).toBeTruthy();
  });
});
