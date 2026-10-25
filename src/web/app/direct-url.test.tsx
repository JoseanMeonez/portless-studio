import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup() {
  const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
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

async function detectedRow(port: number): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Detected ports" });
  return list.querySelector(`[data-port="${port}"]`) as HTMLElement;
}

const menu = () => screen.findByRole("menu", { name: /Actions for/ });

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("direct URL", () => {
  it("shows each route's localhost URL and copies it on click", async () => {
    const { user } = setup();
    const row = await routeRow("storybook");
    const direct = within(row).getByRole("button", {
      name: "Copy direct URL http://localhost:6006",
    });
    expect(direct.textContent).toBe("http://localhost:6006");
    await user.click(direct);
    expect(await navigator.clipboard.readText()).toBe("http://localhost:6006");
    expect(await screen.findByText("Copied direct URL")).toBeTruthy();
  });

  it("shows it on detected ports, Docker ones with the published host port", async () => {
    const { user } = setup();
    const row = await detectedRow(4209);
    await user.click(
      within(row).getByRole("button", { name: "Copy direct URL http://localhost:4209" }),
    );
    expect(await navigator.clipboard.readText()).toBe("http://localhost:4209");
    const docker = await detectedRow(8090);
    expect(
      within(docker).getByRole("button", { name: "Copy direct URL http://localhost:8090" }),
    ).toBeTruthy();
  });

  it("copies and opens it from the row menu", async () => {
    const { user } = setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Copy direct URL" }));
    expect(await navigator.clipboard.readText()).toBe("http://localhost:6006");
    fireEvent.contextMenu(await routeRow("storybook"));
    await user.click(within(await menu()).getByRole("menuitem", { name: "Open direct URL" }));
    expect(open).toHaveBeenCalledWith("http://localhost:6006", "_blank", "noopener,noreferrer");
  });

  it("copies the selected route's from the command menu", async () => {
    const { user } = setup();
    await user.click(await routeRow("storybook"));
    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: /Copy direct URL of storybook/ }));
    expect(await navigator.clipboard.readText()).toBe("http://localhost:6006");
  });
});
