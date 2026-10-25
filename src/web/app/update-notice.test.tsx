import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UpdateStatus } from "../../core/api/contract.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function status(latest: string, available = true): UpdateStatus {
  return { current: "0.1.0", latest, available, command: "npm i -g portless-studio" };
}

function setup(update: UpdateStatus) {
  const gateway = Object.assign(new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW), {
    getUpdateStatus: async () => ({ ok: true as const, value: update }),
  });
  const user = userEvent.setup();
  const view = render(<App gateway={gateway} />);
  return { user, view };
}

beforeEach(() => localStorage.clear());

describe("update notice", () => {
  it("names the new version and the command to install it", async () => {
    setup(status("0.2.0"));
    expect(await screen.findByText("portless-studio 0.2.0 is available")).toBeTruthy();
    expect(screen.getByText("npm i -g portless-studio")).toBeTruthy();
  });

  it("stays hidden once dismissed, until a newer version comes out", async () => {
    const first = setup(status("0.2.0"));
    await first.user.click(
      await screen.findByRole("button", { name: "Dismiss the update notice" }),
    );
    expect(screen.queryByText("portless-studio 0.2.0 is available")).toBeNull();
    first.view.unmount();

    const again = setup(status("0.2.0"));
    await screen.findByRole("list", { name: "Routes" });
    expect(screen.queryByText("portless-studio 0.2.0 is available")).toBeNull();
    again.view.unmount();

    setup(status("0.3.0"));
    expect(await screen.findByText("portless-studio 0.3.0 is available")).toBeTruthy();
  });

  it("shows nothing when Studio runs the latest version", async () => {
    setup(status("0.1.0", false));
    await screen.findByRole("list", { name: "Routes" });
    await waitFor(() => expect(screen.queryByText(/is available/)).toBeNull());
  });
});
