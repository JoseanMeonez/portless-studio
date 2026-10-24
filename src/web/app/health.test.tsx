import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup(options: { proxyOwner?: "you" | "root"; loginService?: boolean } = {}) {
  const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW, options);
  const user = userEvent.setup();
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<App gateway={gateway} />);
  return { gateway, user };
}

const routeRow = async (name: string) => {
  const list = await screen.findByRole("list", { name: "Routes" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("a")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

const detectedRow = async (port: number) => {
  const list = await screen.findByRole("list", { name: "Detected ports" });
  const row = list.querySelector(`[data-port="${port}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${port}`);
  return row;
};

afterEach(() => vi.restoreAllMocks());

describe("Health panel", () => {
  it("shows the overall status in the header and lists every check", async () => {
    const { user } = setup();
    const button = await screen.findByRole("button", { name: "Health: 1 warning" });

    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Health" });

    expect(
      await within(dialog).findByText("Chrome may not trust the HTTPS certificate"),
    ).toBeTruthy();
    expect(within(dialog).getByText("The proxy runs as you")).toBeTruthy();
    expect(within(dialog).getByText("Studio answers on port 4949")).toBeTruthy();
  });

  it("runs a fix and shows the checks again", async () => {
    const { user, gateway } = setup();
    const runFix = vi.spyOn(gateway, "runDoctorFix");
    await user.click(await screen.findByRole("button", { name: "Health: 1 warning" }));
    const dialog = screen.getByRole("dialog", { name: "Health" });

    await user.click(
      await within(dialog).findByRole("button", { name: "Switch to HTTP on port 1355" }),
    );

    expect(runFix).toHaveBeenCalledWith("https-trust");
    expect(await screen.findByText("Restarted the proxy on port 1355.")).toBeTruthy();
    await waitFor(() =>
      expect(within(dialog).queryByText("Chrome may not trust the HTTPS certificate")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Health: all good" })).toBeTruthy();
  });

  it("shows a fix that needs sudo as a command to copy", async () => {
    const { user } = setup({ proxyOwner: "root" });
    await user.click(await screen.findByRole("button", { name: "Health: 2 warnings" }));
    const dialog = screen.getByRole("dialog", { name: "Health" });

    expect(
      await within(dialog).findByRole("button", { name: "Copy command: sudo portless proxy stop" }),
    ).toBeTruthy();
  });

  it("stops Studio after a confirmation and explains how to start it again", async () => {
    const { user, gateway } = setup();
    const control = vi.spyOn(gateway, "controlStudio");
    await user.click(await screen.findByRole("button", { name: "Health: 1 warning" }));
    const dialog = screen.getByRole("dialog", { name: "Health" });

    await user.click(within(dialog).getByRole("button", { name: "Stop Studio" }));
    expect(control).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Yes, stop Studio" }));

    expect(control).toHaveBeenCalledWith("stop");
    expect(await screen.findByRole("heading", { name: "Studio stopped" })).toBeTruthy();
    expect(screen.getByText("systemctl --user start portless-studio")).toBeTruthy();
  });

  it("restarts Studio with a toast", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Health: 1 warning" }));
    await user.click(screen.getByRole("button", { name: "Restart Studio" }));
    expect(await screen.findByText("Studio is restarting.")).toBeTruthy();
  });
});

describe("proxy menu", () => {
  it("stops and starts the proxy from the header pill", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Proxy: running/ }));
    await user.click(screen.getByRole("menuitem", { name: "Stop proxy" }));

    expect(await screen.findByText("Stopped the proxy.")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /Proxy: stopped/ }));
    expect(screen.getByRole("menuitem", { name: "Stop proxy" }).hasAttribute("disabled")).toBe(
      true,
    );
    await user.click(screen.getByRole("menuitem", { name: "Start proxy" }));

    expect(await screen.findByText("Started the proxy on port 1355.")).toBeTruthy();
  });

  it("explains that a proxy owned by root needs sudo", async () => {
    const { user } = setup({ proxyOwner: "root" });
    await user.click(await screen.findByRole("button", { name: /Proxy: running/ }));
    await user.click(screen.getByRole("menuitem", { name: "Restart proxy" }));

    expect(await screen.findByText("Could not restart the proxy")).toBeTruthy();
    expect(screen.getByText(/Run: sudo portless proxy stop/)).toBeTruthy();
  });

  it("offers the proxy actions in the command menu", async () => {
    const { user } = setup();
    await screen.findByRole("list", { name: "Routes" });
    await user.keyboard("{Control>}k{/Control}");
    const menu = screen.getByRole("dialog");
    expect(within(menu).getByText("Restart proxy")).toBeTruthy();
    await user.click(within(menu).getByText("Open health panel"));
    expect(screen.getByRole("dialog", { name: "Health" })).toBeTruthy();
  });
});

describe("stopping a dev server", () => {
  it("asks first, naming the process and port, then stops a detected server", async () => {
    const { user, gateway } = setup();
    const stop = vi.spyOn(gateway, "stopProcess");
    const row = await detectedRow(4209);

    await user.click(within(row).getByRole("button", { name: "Stop the server on port 4209" }));
    expect(row.textContent).toContain("Stop ng on :4209?");
    await user.click(within(row).getByRole("button", { name: "Stop" }));

    expect(stop).toHaveBeenCalledWith(61_480);
    expect(await screen.findByText("Stopped ng on port 4209")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Detected ports" }).querySelector('[data-port="4209"]'),
      ).toBeNull(),
    );
  });

  it("can cancel the confirmation", async () => {
    const { user, gateway } = setup();
    const stop = vi.spyOn(gateway, "stopProcess");
    const row = await detectedRow(5173);
    await user.click(within(row).getByRole("button", { name: "Stop the server on port 5173" }));
    await user.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops the server behind a route whose port has a known pid", async () => {
    const { user, gateway } = setup();
    const stop = vi.spyOn(gateway, "stopProcess");
    const row = await routeRow("storybook");

    await user.click(within(row).getByRole("button", { name: "Stop the server of storybook" }));
    expect(row.textContent).toContain("Stop :6006 (pid 50121)?");
    await user.click(within(row).getByRole("button", { name: "Stop" }));

    expect(stop).toHaveBeenCalledWith(50_121);
    expect(await screen.findByText("Stopped the server on port 6006")).toBeTruthy();
    expect(within(await routeRow("storybook")).getByTitle("Not answering")).toBeTruthy();
  });

  it("has no stop action for a route without a known pid", async () => {
    setup();
    const row = await routeRow("redis");
    expect(within(row).queryByRole("button", { name: /Stop the server/ })).toBeNull();
  });
});

describe("route health", () => {
  it("shows whether each route answers, with the status and time in the tooltip", async () => {
    setup();
    expect(within(await routeRow("web.acme")).getByTitle("200 in 12 ms")).toBeTruthy();
    expect(within(await routeRow("docs")).getByTitle("500 in 31 ms")).toBeTruthy();
    expect(within(await routeRow("db")).getByTitle("Not answering")).toBeTruthy();
  });
});
