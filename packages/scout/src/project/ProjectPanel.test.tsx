import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPanel } from "./ProjectPanel";
import { boardState, item, makeActions } from "../home/fixtures.test-utils";
import type { ProjectPanelProps } from "../contracts";

afterEach(cleanup);

function setup() {
  const state = boardState();
  state.items.push(item("i10", "p1", "Follow up with trial users", "backlog", 1, { origin: "rule", subtitle: "Gmail · you@livecase.example" }));
  const props: ProjectPanelProps = {
    state, db: null, actions: makeActions(), projectId: "p1",
    onClose: vi.fn(), onOpenItem: vi.fn(), onNewItem: vi.fn(),
  };
  render(<ProjectPanel {...props} />);
  return props;
}

describe("ProjectPanel", () => {
  it("populates Focus, Backlog and Done lanes", () => {
    setup();
    const focus = screen.getByRole("region", { name: "Focus" });
    expect(within(focus).getAllByRole("article").map(a => a.getAttribute("aria-label")))
      .toEqual(["Reply to Acme about pricing", "Demo with Northwind"]);
    expect(within(focus).getByText("Needs you")).toBeTruthy();
    expect(within(focus).getByText("Agent is on it")).toBeTruthy();
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getAllByRole("article").map(a => a.getAttribute("aria-label")))
      .toEqual(["Update the pipeline sheet", "Follow up with trial users"]);
    expect(within(backlog).getByText("Added by a rule")).toBeTruthy();
    expect(screen.getByText("2 Focus")).toBeTruthy();
    expect(screen.getByText("2 Backlog")).toBeTruthy();
    const done = screen.getByRole("region", { name: "Done" });
    fireEvent.click(within(done).getByRole("button", { name: "Show 1 done" }));
    expect(within(done).getByText("Sent invoice")).toBeTruthy();
  });

  it("up arrow moves a backlog item to the end of Focus", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Move Update the pipeline sheet to Focus" }));
    expect(props.actions.itemMove).toHaveBeenCalledWith("i3", "focus", 2);
  });

  it("Let's go sits on the first needs-you focus item and opens it", () => {
    const props = setup();
    const go = screen.getAllByRole("button", { name: "Let's go" });
    expect(go).toHaveLength(1);
    expect(go[0].closest("article")?.getAttribute("aria-label")).toBe("Reply to Acme about pricing");
    fireEvent.click(go[0]);
    expect(props.onOpenItem).toHaveBeenCalledWith("i1");
  });

  it("+ Add opens a new item for this project; close calls onClose", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(props.onNewItem).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
