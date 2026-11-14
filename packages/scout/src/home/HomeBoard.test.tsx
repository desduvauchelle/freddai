import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeBoard } from "./HomeBoard";
import { boardState, makeActions } from "./fixtures.test-utils";
import type { HomeBoardProps } from "../contracts";

afterEach(cleanup);

function setup(patch: Partial<HomeBoardProps> = {}) {
  const props: HomeBoardProps = {
    state: boardState(), db: null, actions: makeActions(), workspaceFilter: null, search: "",
    onOpenProject: vi.fn(), onOpenItem: vi.fn(), onNewItem: vi.fn(), ...patch,
  };
  render(<HomeBoard {...props} />);
  return props;
}

describe("HomeBoard", () => {
  it("shows Pinned first, then expanded workspaces by order; collapsed as chips; hidden excluded", () => {
    setup();
    expect(screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent)).toEqual(["Pinned", "LiveCase", "Freddai"]);
    const pinned = screen.getByRole("region", { name: "Pinned" });
    expect(within(pinned).getAllByRole("article").map(a => a.getAttribute("aria-label"))).toEqual(["Sales"]);
    // Pinned projects stay in their workspace too, ordered by `order`.
    const livecase = screen.getByRole("region", { name: "LiveCase" });
    expect(within(livecase).getAllByRole("article").map(a => a.getAttribute("aria-label"))).toEqual(["Sales", "Support"]);
    expect(screen.queryByRole("article", { name: "Archive" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Home" }).textContent).toContain("1 project");
    expect(screen.getByRole("button", { name: "Show 1 hidden projects" })).toBeTruthy();
  });

  it("computes header counts from visible projects, ignoring done items", () => {
    setup();
    const totals = screen.getByLabelText("Totals");
    expect(totals.textContent).toContain("3 need you"); // i1, i4, i7 (i8 is in a hidden project)
    expect(totals.textContent).toContain("4 in focus"); // i1, i2, i4, i7
    expect(totals.textContent).toContain("3 in backlog"); // i3, i5, i6
  });

  it("card meta line, item click opens the item, card click opens the project", () => {
    const props = setup();
    const sales = within(screen.getByRole("region", { name: "LiveCase" })).getByRole("article", { name: "Sales" });
    expect(within(sales).getByText("1 needs you · 1 in backlog")).toBeTruthy();
    fireEvent.click(within(sales).getByRole("button", { name: /^(?!Unpin).*Reply to Acme/ }));
    expect(props.onOpenItem).toHaveBeenCalledWith("i1");
    expect(props.onOpenProject).not.toHaveBeenCalled();
    fireEvent.click(sales);
    expect(props.onOpenProject).toHaveBeenCalledWith("p1");
  });

  it("search matches item titles and project names", () => {
    setup({ search: "refund" });
    expect(screen.getByRole("article", { name: "Support" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Sales" })).toBeNull();
    expect(screen.queryByText("Fix login redirect loop")).toBeNull();
    cleanup();
    setup({ search: "build" });
    expect(screen.getByRole("article", { name: "Build" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Support" })).toBeNull();
  });

  it("filters by workspace", () => {
    setup({ workspaceFilter: "w2" });
    expect(screen.getByRole("article", { name: "Build" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Sales" })).toBeNull();
  });

  it("hide action saves the project with hidden: true without opening it", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hide Support" }));
    expect(props.actions.projectSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p2", hidden: true }));
    expect(props.onOpenProject).not.toHaveBeenCalled();
  });

  it("pin, new item and unhide actions", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pin Support" }));
    expect(props.actions.projectSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p2", pinned: true }));
    fireEvent.click(screen.getByRole("button", { name: "New item in Build" }));
    expect(props.onNewItem).toHaveBeenCalledWith("p3");
    fireEvent.click(screen.getByRole("button", { name: "Show 1 hidden projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Archive" }));
    expect(props.actions.projectSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p5", hidden: false }));
  });

  it("every workspace spans a full row (no span classes)", () => {
    setup();
    expect(document.querySelectorAll('[class*="hb-ws--span"]').length).toBe(0);
    expect(screen.queryByText("All clear")).toBeNull();
  });

  it("focus rows show an Unpin button that moves the item to backlog; backlog rows have none", () => {
    const props = setup();
    const sales = within(screen.getByRole("region", { name: "LiveCase" })).getByRole("article", { name: "Sales" });
    fireEvent.click(within(sales).getByRole("button", { name: "Unpin Reply to Acme about pricing" }));
    expect(props.actions.itemMove).toHaveBeenCalledWith("i1", "backlog", 0);
    expect(props.onOpenItem).not.toHaveBeenCalled();
    expect(props.onOpenProject).not.toHaveBeenCalled();
    const unpins = within(sales).getAllByRole("button", { name: /^Unpin / }).map(b => b.getAttribute("aria-label"));
    // "Unpin Sales" is the project pin; the rest are focus rows only (backlog "Update the pipeline sheet" has none).
    expect(unpins).toEqual(["Unpin Sales", "Unpin Reply to Acme about pricing", "Unpin Demo with Northwind"]);
    expect(within(sales).queryByRole("button", { name: "Unpin Update the pipeline sheet" })).toBeNull();
  });
});
