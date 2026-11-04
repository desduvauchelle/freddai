import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Office } from "./index";
import type { Project, Session } from "../desktop/types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#888", policy: "inherit", account: null, last: null });
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: `Title ${id}`, project: "alpha", account: "a", status: "running", updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null, ...over });
const projects = [project("alpha", "Alpha"), project("beta", "Beta")];
const sessions = [thread("1"), thread("2", { project: "beta", status: "waiting" })];
afterEach(cleanup);

const mini = (over = {}) => {
  const onOpenThread = vi.fn();
  render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={onOpenThread} {...over} />);
  return onOpenThread;
};

it("mini renders agents as buttons with project, title and state text", () => {
  mini();
  expect(screen.getByRole("button", { name: "Alpha · Title 1 · Working" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Beta · Title 2 · Needs you" })).toBeTruthy();
  expect(screen.getByText("1 working · 1 needs you")).toBeTruthy();
});

it("clicking an agent opens its thread", () => {
  const open = mini();
  fireEvent.click(screen.getByRole("button", { name: /Title 2/ }));
  expect(open).toHaveBeenCalledWith("2");
});

it("expand opens the full overlay, Escape closes it and restores focus", () => {
  const onExpand = vi.fn(), onClose = vi.fn();
  mini({ onExpand, onClose });
  const expand = screen.getByRole("button", { name: "Expand office" });
  expand.focus();
  fireEvent.click(expand);
  const dialog = screen.getByRole("dialog", { name: "Office" });
  expect(onExpand).toHaveBeenCalled();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close office" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onClose).toHaveBeenCalled();
  expect(document.activeElement).toBe(expand);
});

it("clicking the mini background expands; opening an agent from full closes the overlay and opens the thread", () => {
  const open = mini();
  fireEvent.click(document.querySelector(".office-stage") as HTMLElement);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /Title 1/ }));
  expect(open).toHaveBeenCalledWith("1");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("full variant renders the overlay directly and traps Tab focus", () => {
  const onClose = vi.fn();
  render(<Office variant="full" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} onClose={onClose} />);
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  buttons[buttons.length - 1].focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close office" }));
  expect(onClose).toHaveBeenCalled();
});

it("shows the clock shrine only when schedules exist", () => {
  mini();
  expect(screen.queryByLabelText("Scheduled work")).toBeNull();
  cleanup();
  mini({ schedules: [{ id: "s", name: "Nightly", project: "alpha", next_due: NOW + 3600_000, enabled: true }] });
  expect(screen.getByLabelText("Scheduled work").textContent).toContain("1 scheduled");
});

it("draws the floor plan as one scaling SVG with a room sign, reception tag and attention badge", () => {
  mini();
  const svg = document.querySelector("svg.office-svg") as SVGSVGElement;
  expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
  expect(svg.getAttribute("width")).toBeNull();
  expect(screen.getByLabelText("Alpha room")).toBeTruthy();
  const reception = screen.getByLabelText("Reception");
  expect(reception.textContent).toContain("WAITING FOR YOU · 1");
  expect(reception.textContent).toContain("Title 2");
  expect(within(screen.getByLabelText("Beta room").parentElement as HTMLElement).queryAllByText("1").length).toBeGreaterThan(0);
});

it("legend counts every state with text, and Enter on an agent opens its thread", () => {
  const open = mini();
  const legend = screen.getByLabelText("Agent states");
  expect(legend.textContent).toContain("Needs you1");
  expect(legend.textContent).toContain("Working1");
  fireEvent.keyDown(screen.getByRole("button", { name: /Title 1/ }), { key: "Enter" });
  expect(open).toHaveBeenCalledWith("1");
});
