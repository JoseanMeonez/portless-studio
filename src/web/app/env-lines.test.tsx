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

async function openCommand(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await routeRow("web.acme");
  await user.keyboard("{Control>}k{/Control}");
  await user.click(await screen.findByRole("option", { name }));
}

const ALL_LINES = [
  "API_ACME_URL=http://api.acme.localhost:1355",
  "DB_URL=http://db.localhost:1355",
  "DOCS_URL=http://docs.localhost:1355",
  "REDIS_URL=http://redis.localhost:1355",
  "STORYBOOK_URL=http://storybook.localhost:1355",
  "WEB_ACME_URL=http://web.acme.localhost:1355",
].join("\n");

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe(".env lines", () => {
  it("copies one route as a .env line from the row menu", async () => {
    const { user } = setup();
    fireEvent.contextMenu(await routeRow("api.acme"));
    const menu = await screen.findByRole("menu", { name: /Actions for/ });
    await user.click(within(menu).getByRole("menuitem", { name: "Copy as .env line" }));
    expect(await navigator.clipboard.readText()).toBe(
      "API_ACME_URL=http://api.acme.localhost:1355",
    );
    expect(await screen.findByText("Copied .env line")).toBeTruthy();
  });

  it("copies every route as .env lines from the command menu", async () => {
    const { user } = setup();
    await openCommand(user, /Copy routes as \.env$/);
    expect(await navigator.clipboard.readText()).toBe(ALL_LINES);
  });

  it("builds lines in the dialog from the chosen routes, prefix and strip suffix", async () => {
    const { user } = setup();
    await openCommand(user, /Choose routes for \.env/);
    const dialog = await screen.findByRole("dialog", { name: "Copy routes as .env lines" });
    const preview = within(dialog).getByLabelText("Preview");
    expect(preview.textContent).toBe(ALL_LINES);

    for (const name of ["db", "docs", "redis", "storybook"]) {
      await user.click(within(dialog).getByRole("checkbox", { name }));
    }
    await user.type(within(dialog).getByLabelText("Prefix"), "VITE_");
    await user.type(within(dialog).getByLabelText("Strip suffix"), "acme");
    expect(preview.textContent).toBe(
      "VITE_API_URL=http://api.acme.localhost:1355\nVITE_WEB_URL=http://web.acme.localhost:1355",
    );

    await user.click(within(dialog).getByRole("switch", { name: "Direct URLs" }));
    expect(preview.textContent).toBe(
      "VITE_API_URL=http://localhost:4000\nVITE_WEB_URL=http://localhost:3000",
    );
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(preview.textContent);
  });

  it("says why it cannot build the lines and turns Copy off", async () => {
    const { user } = setup();
    await openCommand(user, /Choose routes for \.env/);
    const dialog = await screen.findByRole("dialog", { name: "Copy routes as .env lines" });
    await user.type(within(dialog).getByLabelText("Prefix"), "1x");
    expect(within(dialog).getByRole("alert").textContent).toContain('The prefix "1x"');
    expect(within(dialog).getByRole("button", { name: "Copy" })).toHaveProperty("disabled", true);
  });
});
