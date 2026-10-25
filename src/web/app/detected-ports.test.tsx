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

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function withHelperPorts(): Snapshot {
  const sample = createSampleSnapshot(NOW);
  const [first, ...rest] = sample.detected;
  if (!first) throw new Error("the sample has detected ports");
  const helper = { pid: 900, processName: "workerd", cwd: null, suggestedName: null };
  return {
    ...sample,
    detected: [{ ...first, extraPorts: [4210] }, ...rest],
    otherPorts: [
      { ...helper, port: 9229, reason: "debugger", routeName: "api.acme" },
      { ...helper, port: 33111, reason: "sibling", routeName: "api.acme" },
      { ...helper, port: 44491, processName: "node", reason: "ephemeral" },
    ],
  };
}

describe("detected ports", () => {
  it("lists ports that answer HTTP with their process, folder and suggested name", async () => {
    setup();

    expect(await detectedPorts()).toEqual(["4209", "4321", "5173", "8000", "8090"]);
    expect(screen.getByRole("heading", { name: /Detected on this machine/ })).toBeTruthy();
    const row = within(await detectedList()).getAllByRole("listitem")[2];
    expect(row?.textContent).toContain("app.acme");
    expect(row?.textContent).toContain("node");
    expect(row?.querySelector("[title='/home/dev/code/acme/apps/app']")?.textContent).toBe(
      "~/code/acme/apps/app",
    );
  });

  it("shows a Docker container with a badge and its image, and stops it after confirmation", async () => {
    const { user, gateway } = setup();
    const stopContainer = vi.spyOn(gateway, "stopContainer");
    const stopProcess = vi.spyOn(gateway, "stopProcess");
    const row = within(await detectedList())
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("data-port") === "8090");

    expect(row?.textContent).toContain("worker.acme");
    expect(within(row as HTMLElement).getByText("Docker")).toBeTruthy();
    expect(row?.textContent).toContain("acme/worker:dev");

    await user.click(screen.getByRole("button", { name: "Stop the container on port 8090" }));
    expect(screen.getByText("Stop container acme-worker-1 on :8090?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(stopContainer).toHaveBeenCalledWith("acme-worker-1");
    expect(stopProcess).not.toHaveBeenCalled();
    expect(await screen.findByText("Stopped container acme-worker-1")).toBeTruthy();
    await waitFor(async () => expect(await detectedPorts()).not.toContain("8090"));
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

    expect(await screen.findByText("Named 4 ports")).toBeTruthy();
    expect(createAlias).toHaveBeenCalledTimes(4);
    expect(await routeNames()).toEqual(
      expect.arrayContaining(["app.acme", "blog.acme", "otter.shop-admin", "worker.acme"]),
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

    expect(await detectedPorts()).toHaveLength(5);
    expect(screen.queryByText("No routes yet")).toBeNull();
  });

  it("lists a process's extra ports in its row", async () => {
    setup(withHelperPorts());
    const row = within(await detectedList()).getAllByRole("listitem")[0];
    expect(row?.textContent).toContain("Also answers on");
    expect(
      within(row as HTMLElement).getByRole("button", {
        name: "Copy direct URL http://localhost:4210",
      }),
    ).toBeTruthy();
  });

  it("keeps helper ports under a closed Other ports with their reason, and remembers it open", async () => {
    const { user } = setup(withHelperPorts());
    const toggle = await screen.findByRole("button", { name: "Other ports (3)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Other ports" })).toBeNull();
    expect(await detectedPorts()).not.toContain("9229");

    await user.click(toggle);
    const list = screen.getByRole("list", { name: "Other ports" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringMatching(/:9229.*workerd.*debugger of api\.acme.*localhost:9229/),
      expect.stringMatching(/:33111.*internal port of api\.acme/),
      expect.stringMatching(/:44491.*node.*temporary port/),
    ]);
    expect(localStorage.getItem("portless-studio:detected-other-open")).toBe("1");
  });

  it("folds the whole section down to its title and remembers it", async () => {
    const { user } = setup(withHelperPorts());
    await detectedList();
    const title = screen.getByRole("button", { name: /Detected on this machine/ });
    expect(title.getAttribute("aria-expanded")).toBe("true");

    await user.click(title);
    expect(title.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Detected ports" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Other ports/ })).toBeNull();
    expect(localStorage.getItem("portless-studio:detected-collapsed")).toBe("1");
  });

  it("starts folded when it was folded before, and shows the section for other ports alone", async () => {
    localStorage.setItem("portless-studio:detected-collapsed", "1");
    setup({ ...withHelperPorts(), detected: [] });
    const title = await screen.findByRole("button", { name: /Detected on this machine/ });
    expect(title.getAttribute("aria-expanded")).toBe("false");
  });

  it("still works when the browser blocks storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { user } = setup(withHelperPorts());
    const toggle = await screen.findByRole("button", { name: "Other ports (3)" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
