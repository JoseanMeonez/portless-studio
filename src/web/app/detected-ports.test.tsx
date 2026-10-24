import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "../../core/api/contract.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup(snapshot: Snapshot = createSampleSnapshot(NOW)) {
  const gateway = new InMemoryRoutesGateway(snapshot, () => NOW);
  const user = userEvent.setup();
  render(<App gateway={gateway} />);
  return { gateway, user };
}

const detectedList = () => screen.findByRole("list", { name: "Detected ports" });

async function detectedPorts(): Promise<string[]> {
  const rows = within(await detectedList()).queryAllByRole("listitem");
  return rows.map((row) => row.getAttribute("data-port") ?? "");
}

async function routeNames(): Promise<string[]> {
  const list = await screen.findByRole("list", { name: "Routes" });
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector("a")?.textContent ?? "");
}

afterEach(() => vi.restoreAllMocks());

describe("detected ports", () => {
  it("lists ports that answer HTTP with their process, folder and suggested name", async () => {
    setup();

    expect(await detectedPorts()).toEqual(["4209", "4321", "5173", "8000"]);
    expect(screen.getByRole("heading", { name: /Detected on this machine/ })).toBeTruthy();
    const row = within(await detectedList()).getAllByRole("listitem")[2];
    expect(row?.textContent).toContain("app.acme");
    expect(row?.textContent).toContain("node");
    expect(row?.querySelector("[title='/home/dev/code/acme/apps/app']")?.textContent).toBe(
      "~/code/acme/apps/app",
    );
  });

  it("shows the icon the server found for a detected port", async () => {
    const icon = "data:image/svg+xml;base64,PHN2Zy8+";
    const sample = createSampleSnapshot(NOW);
    setup({ ...sample, detected: sample.detected.map((item) => ({ ...item, icon })) });

    const row = within(await detectedList()).getAllByRole("listitem")[0];
    expect(row?.querySelector("img")?.getAttribute("src")).toBe(icon);
  });

  it("hides the section when nothing is detected", async () => {
    setup({ ...createSampleSnapshot(NOW), detected: [] });

    await screen.findByRole("list", { name: "Routes" });
    expect(screen.queryByRole("heading", { name: /Detected on this machine/ })).toBeNull();
  });

  it("opens the Name dialog with the suggested name and moves the port to routes", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Name port 5173" }));
    const dialog = screen.getByRole("dialog", { name: "Name a port" });

    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("app.acme");
    expect((within(dialog).getByLabelText("Port") as HTMLInputElement).value).toBe("5173");
    await user.click(within(dialog).getByRole("button", { name: "Name port" }));

    expect(await routeNames()).toContain("app.acme");
    expect(await detectedPorts()).not.toContain("5173");
  });

  it("ignores a port and removes its row", async () => {
    const { user, gateway } = setup();
    const ignore = vi.spyOn(gateway, "ignoreDetected");

    await user.click(await screen.findByRole("button", { name: "Ignore port 8000" }));

    expect(ignore).toHaveBeenCalledWith(8000);
    await waitFor(async () => expect(await detectedPorts()).not.toContain("8000"));
  });

  it("names every port that has a suggestion with one summary toast", async () => {
    const { user, gateway } = setup();
    const createAlias = vi.spyOn(gateway, "createAlias");

    await user.click(await screen.findByRole("button", { name: "Name all" }));

    expect(await screen.findByText("Named 3 ports")).toBeTruthy();
    expect(createAlias).toHaveBeenCalledTimes(3);
    expect(await routeNames()).toEqual(
      expect.arrayContaining(["app.acme", "blog.acme", "otter.shop-admin"]),
    );
    expect(await detectedPorts()).toEqual(["8000"]);
  });

  it("turns auto mode on from the section and shows it in the header", async () => {
    const { user, gateway } = setup();
    const updateConfig = vi.spyOn(gateway, "updateConfig");
    await detectedList();
    expect(screen.queryByText("Auto mode on")).toBeNull();

    const toggle = screen.getByRole("switch", { name: "Auto-name new servers" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ autoName: true }));
    expect(await screen.findByText("Auto mode on")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("filters detected rows with the same filter as routes", async () => {
    const { user } = setup();
    await detectedList();

    await user.keyboard("/");
    await user.keyboard("otter");

    expect(await detectedPorts()).toEqual(["4209"]);
  });

  it("makes the detected ports the main content when there are no routes", async () => {
    setup({ ...createSampleSnapshot(NOW), routes: [] });

    expect(await detectedPorts()).toHaveLength(4);
    expect(screen.queryByText("No routes yet")).toBeNull();
  });
});
