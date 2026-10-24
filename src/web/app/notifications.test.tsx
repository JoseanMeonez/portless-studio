import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudioEvent } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import { createSampleSnapshot, InMemoryRoutesGateway } from "../features/routes/index.ts";
import { App } from "./app.tsx";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function setup(gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW)) {
  const user = userEvent.setup();
  const view = render(<App gateway={gateway} />);
  return { gateway, user, view };
}

let count = 0;
function event(change: Partial<StudioEvent> = {}): StudioEvent {
  count += 1;
  return {
    id: `e-${count}`,
    kind: "named",
    title: "Named api.acme",
    body: "Port 4000 opens at http://api.acme.localhost",
    target: { route: "api.acme", port: 4000 },
    at: Date.now(),
    ...change,
  };
}

const selectedRow = () => document.querySelector('[aria-current="true"]');
const bell = () => screen.getByRole("button", { name: /^Notifications/ });

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this);
  }
  close() {
    this.closed = true;
  }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  FakeNotification.shown = [];
  FakeNotification.permission = "granted";
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility("visible");
});

describe("in-app notifications", () => {
  it("shows a toast whose Show button clears the search hiding the item and selects it", async () => {
    const { gateway, user } = setup();
    await screen.findByRole("list", { name: "Routes" });
    await user.type(screen.getByLabelText("Filter routes"), "nothing-matches-this");

    act(() => gateway.emitEvent(event()));
    const toast = (await screen.findByText("Named api.acme")).closest("div") as HTMLElement;
    expect(within(toast).getByText("Port 4000 opens at http://api.acme.localhost")).toBeTruthy();
    await user.click(within(toast).getByRole("button", { name: "Show" }));

    expect((screen.getByLabelText("Filter routes") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(selectedRow()?.textContent).toContain("api.acme"));
  });

  it("scrolls to a detected port", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { gateway, user } = setup();
    await screen.findByRole("list", { name: "Routes" });

    act(() =>
      gateway.emitEvent(
        event({ kind: "detected", title: "New server on port 5173", target: { port: 5173 } }),
      ),
    );
    const toast = (await screen.findByText("New server on port 5173")).closest(
      "div",
    ) as HTMLElement;
    await user.click(within(toast).getByRole("button", { name: "Show" }));
    await waitFor(() =>
      expect(
        scroll.mock.contexts.some((row) => (row as Element).getAttribute("data-port") === "5173"),
      ).toBe(true),
    );
  });

  it("does not toast events from before the page opened, but lists them", async () => {
    const gateway = new InMemoryRoutesGateway(createSampleSnapshot(NOW), () => NOW);
    gateway.emitEvent(event({ title: "Named old.acme", at: Date.now() - 60 * 60_000 }));
    const { user } = setup(gateway);
    await screen.findByRole("list", { name: "Routes" });

    expect(screen.queryByText("Named old.acme")).toBeNull();
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
    await user.click(bell());
    expect(
      within(screen.getByRole("menu", { name: "Notifications" })).getByText("Named old.acme"),
    ).toBeTruthy();
  });
});

describe("notification bell", () => {
  it("counts unread events, lists the recent ones and remembers what was read", async () => {
    const { gateway, user, view } = setup();
    await screen.findByRole("list", { name: "Routes" });
    expect(bell().getAttribute("aria-label")).toBe("Notifications");

    act(() => {
      gateway.emitEvent(event({ title: "Named web.acme", target: { route: "web.acme" } }));
      gateway.emitEvent(event());
    });
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread"));

    await user.click(bell());
    const menu = screen.getByRole("menu", { name: "Notifications" });
    const items = within(menu).getAllByRole("menuitem");
    // Newest first.
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Named api.acme"),
      expect.stringContaining("Named web.acme"),
    ]);
    expect(bell().getAttribute("aria-label")).toBe("Notifications");

    await user.click(items[1] as HTMLElement);
    expect(screen.queryByRole("menu", { name: "Notifications" })).toBeNull();
    await waitFor(() => expect(selectedRow()?.textContent).toContain("web.acme"));

    // A reload replays the same events; they stay read.
    view.unmount();
    setup(gateway);
    await screen.findByRole("list", { name: "Routes" });
    expect(bell().getAttribute("aria-label")).toBe("Notifications");
  });

  it("selects the route named in the link a system notification opens", async () => {
    window.history.replaceState(null, "", "/?focus=api.acme");
    setup();
    await waitFor(() => expect(selectedRow()?.textContent).toContain("api.acme"));
    expect(window.location.search).toBe("");
  });
});

describe("desktop notifications", () => {
  async function enable(gateway: InMemoryRoutesGateway) {
    await gateway.updateConfig({ ...DEFAULT_CONFIG, desktopNotifications: true });
  }

  it("shows one while the page is hidden and the setting is on; a click focuses and shows", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const { gateway } = setup();
    await enable(gateway);
    await screen.findByRole("list", { name: "Routes" });

    setVisibility("hidden");
    const sent = event();
    act(() => gateway.emitEvent(sent));
    await waitFor(() => expect(FakeNotification.shown).toHaveLength(1));
    const shown = FakeNotification.shown[0];
    expect(shown?.title).toBe("Named api.acme");
    expect(shown?.options).toEqual({ body: sent.body, tag: sent.id });

    setVisibility("visible");
    act(() => shown?.onclick?.());
    expect(focus).toHaveBeenCalled();
    expect(shown?.closed).toBe(true);
    await waitFor(() => expect(selectedRow()?.textContent).toContain("api.acme"));
  });

  it("shows none while the page is visible", async () => {
    const { gateway } = setup();
    await enable(gateway);
    await screen.findByRole("list", { name: "Routes" });
    act(() => gateway.emitEvent(event()));
    await screen.findByText("Named api.acme");
    expect(FakeNotification.shown).toEqual([]);
  });

  it("shows none when the setting is off", async () => {
    const { gateway } = setup();
    await screen.findByRole("list", { name: "Routes" });
    setVisibility("hidden");
    act(() => gateway.emitEvent(event()));
    await screen.findByText("Named api.acme");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeNotification.shown).toEqual([]);
  });
});
