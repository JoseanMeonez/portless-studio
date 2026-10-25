import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ViewFilters } from "../../../../core/views/view.ts";
import { FilterMenu } from "./filter-menu.tsx";

const PROJECTS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

function Harness({ projects }: { projects: readonly string[] }) {
  const [open, setOpen] = useState(true);
  const [filters, setFilters] = useState<ViewFilters>({ kinds: [], projects: [], statuses: [] });
  return (
    <FilterMenu
      filters={filters}
      projects={projects}
      open={open}
      onOpenChange={setOpen}
      onFiltersChange={setFilters}
    />
  );
}

const projectOptions = () =>
  within(screen.getByRole("group", { name: "Project" }))
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.querySelector("span:last-child")?.textContent);

describe("FilterMenu", () => {
  it("adds a project search when there are more than 6 projects", async () => {
    const user = userEvent.setup();
    render(<Harness projects={PROJECTS} />);

    await user.type(screen.getByRole("searchbox", { name: "Find a project" }), "o");
    expect(projectOptions()).toEqual(["bravo", "echo", "foxtrot", "golf", "hotel"]);

    await user.type(screen.getByRole("searchbox", { name: "Find a project" }), "zz");
    expect(screen.getByText("No projects match.")).toBeTruthy();
  });

  it("has no project search with 6 projects or fewer", () => {
    render(<Harness projects={PROJECTS.slice(0, 6)} />);
    expect(screen.queryByRole("searchbox", { name: "Find a project" })).toBeNull();
    expect(projectOptions()).toHaveLength(6);
  });

  it("disables Clear all until a filter is on", async () => {
    const user = userEvent.setup();
    render(<Harness projects={PROJECTS.slice(0, 2)} />);
    const clear = screen.getByRole("button", { name: "Clear all" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "bravo" }));
    expect(clear.disabled).toBe(false);
    await user.click(clear);
    expect((screen.getByRole("checkbox", { name: "bravo" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });
});
