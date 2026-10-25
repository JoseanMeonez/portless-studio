import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import type { Route } from "../../../../core/routes/route.ts";
import { createSampleSnapshot } from "../data/sample-snapshot.ts";
import { DetectedSection } from "./detected-section.tsx";
import { RouteList } from "./route-list.tsx";
import type { RowTerminal } from "./row-terminal.ts";

// jsdom has no layout, so these tests pin the structure that makes the columns line up: every
// row has the same cells in the same order, and the CSS gives them the same grid tracks.

// jsdom gives `import.meta.url` an http scheme, so read the CSS from the repository root.
const HERE = "src/web/features/routes/components";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const snapshot = createSampleSnapshot(NOW);
const noop = () => {};

const terminal = (running: boolean): RowTerminal => ({
  title: "pnpm dev",
  running,
  exitCode: running ? null : 1,
  onShow: noop,
  onStop: noop,
  onRunAgain: noop,
});

function renderRoutes(confirmingName: string | null) {
  // Every action set a row can have: favorites, tunnels, a running or ended terminal, an editor,
  // alias rename and remove, a stop button, a long name, and a row asking to confirm.
  const routes: Route[] = [
    ...snapshot.routes,
    { ...snapshot.routes[0], name: "a-very-long-route-name.of-a-worktree.acme" } as Route,
  ];
  const terminals = new Map<string, RowTerminal>([
    ["web.acme", terminal(true)],
    ["docs", terminal(false)],
  ]);
  render(
    <RouteList
      sections={[
        { key: "favorites", label: "Favorites", routes: routes.slice(0, 2) },
        { key: "rest", label: "Others", routes: routes.slice(2) },
      ]}
      now={NOW}
      selectedName="api.acme"
      isFavorite={(route) => route.name === "web.acme"}
      isCollapsed={() => false}
      onToggleSection={noop}
      confirming={confirmingName ? { name: confirmingName, action: "stop" } : null}
      onSelect={noop}
      onOpen={noop}
      onCopy={noop}
      onRename={noop}
      onRequestRemove={noop}
      onRequestStop={noop}
      onConfirm={noop}
      onCancelConfirm={noop}
      onToggleFavorite={noop}
      onMoveToGroup={noop}
      onMenu={noop}
      onCopyDirectUrl={noop}
      onOpenTerminal={noop}
      terminalFor={(route) => terminals.get(route.name) ?? null}
      editorFor={(route) => (route.project?.path ? { name: "VS Code", onOpen: noop } : null)}
      onRenameGroup={noop}
      onDeleteGroup={noop}
    />,
  );
  return within(screen.getByRole("list", { name: "Routes" }))
    .getAllByRole("listitem")
    .filter((item) => item.querySelector('[data-cell="meta"]'));
}

const cells = (element: Element) =>
  [...element.children].map((child) => child.getAttribute("data-cell"));

/** The tracks of the first `grid-template-columns` inside `selector`'s first rule. */
function tracks(css: string, selector: string): string[] {
  const block = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css)?.[1];
  const template = /grid-template-columns:\s*([^;]+);/.exec(block ?? "")?.[1] ?? "";
  return template.match(/(?:minmax|var)\([^)]*(?:\([^)]*\))?[^)]*\)|[^\s]+/g) ?? [];
}

describe("route row columns", () => {
  it("gives every row the same cells in the same order, whatever its actions", () => {
    const rows = renderRoutes("docs");
    expect(rows.length).toBe(snapshot.routes.length + 1);
    for (const row of rows) {
      expect(cells(row)).toEqual(["status", "identity", "meta", "actions"]);
      const meta = row.querySelector('[data-cell="meta"]') as Element;
      expect(cells(meta)).toEqual(["tunnels", "kind", "port", "uptime"]);
    }
    // The rows really differ in their actions, which used to push the columns around.
    const counts = rows.map((row) => row.querySelectorAll('[data-cell="actions"] button').length);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it("sizes the actions track and the meta tracks with fixed widths", () => {
    const css = readFileSync(`${HERE}/route-row.module.css`, "utf8");
    const row = tracks(css, ".row");
    expect(row).toEqual(["var(--dot-size)", "minmax(0, 1fr)", "auto", "var(--row-actions-width)"]);
    expect(css).toMatch(/--row-actions-width: \d+px;/);
    const meta = tracks(css, ".meta");
    // Tunnels grow to the left; kind, port and uptime are fixed.
    expect(meta[0]).toBe("auto");
    expect(meta.slice(1).every((track) => /^\d+(px|ch)$/.test(track))).toBe(true);
    // Actions overlay the row instead of taking width from the columns.
    expect(css).toMatch(/\.actions,\n\.confirm \{\n\s+position: absolute;/);
  });
});

describe("detected row columns", () => {
  it("puts the port and uptime in a fixed first track on every row", () => {
    render(
      <DetectedSection
        detected={snapshot.detected}
        totalCount={snapshot.detected.length}
        autoName={false}
        autoNameSaving={false}
        namingAll={false}
        onAutoNameChange={noop}
        onName={noop}
        onIgnore={noop}
        onNameAll={noop}
        confirmingStop={null}
        onRequestStop={noop}
        onConfirmStop={noop}
        onCancelStop={noop}
        onMenu={noop}
        onCopyDirectUrl={noop}
        otherPorts={[]}
        collapsed={false}
        onToggleCollapsed={noop}
        otherPortsOpen={false}
        onToggleOtherPorts={noop}
        now={NOW}
      />,
    );
    const rows = screen
      .getByRole("list", { name: "Detected ports" })
      .querySelectorAll(":scope > li");
    for (const row of rows) expect(cells(row)[0]).toBe("port");
    const css = readFileSync(`${HERE}/detected-row.module.css`, "utf8");
    expect(tracks(css, ".row")[0]).toMatch(/^\d+ch$/);
  });
});
