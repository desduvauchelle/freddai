// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceSettings } from "./WorkspaceSettings";
import type { Project } from "./types";
afterEach(cleanup);
const project: Project = { id: "p", name: "Alpha", path: "/alpha", color: "#ffffff", policy: "inherit", account: null, last: null };
const workspace = { id: "w", name: "Personal", color: "#b59ae9", projects: [] as string[] };
it("creates a trimmed workspace with a chosen color", async () => {
  const save = vi.fn().mockResolvedValue(true);
  render(<WorkspaceSettings projects={[project]} workspaces={[]} disabled={false} onSave={save}/>);
  fireEvent.change(screen.getByLabelText("New workspace name"), { target: { value: " Work " } });
  fireEvent.click(screen.getByRole("button", { name: "Choose new workspace color" }));
  fireEvent.change(screen.getByLabelText("New workspace color"), { target: { value: "#112233" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply color" }));
  fireEvent.click(screen.getByText("Create workspace"));
  expect(save).toHaveBeenCalledWith([expect.objectContaining({ name: "Work", color: "#112233", projects: [] })]);
  await waitFor(() => expect((screen.getByLabelText("New workspace name") as HTMLInputElement).value).toBe(""));
});
it("adds projects through the plus button and by drag and drop without duplicates", () => {
  const save = vi.fn().mockResolvedValue(true);
  const view = render(<WorkspaceSettings projects={[project]} workspaces={[workspace]} disabled={false} onSave={save}/>);
  fireEvent.click(screen.getByText("Add projects"));
  fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
  expect(save).toHaveBeenLastCalledWith([{ ...workspace, projects: ["p"] }]);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.drop(screen.getByRole("region", { name: "Personal workspace" }), { dataTransfer: { getData: () => "p" } });
  expect(save).toHaveBeenCalledTimes(2);
  view.rerender(<WorkspaceSettings projects={[project]} workspaces={[{ ...workspace, projects: ["p"] }]} disabled={false} onSave={save}/>);
  fireEvent.drop(screen.getByRole("region", { name: "Personal workspace" }), { dataTransfer: { getData: () => "p" } });
  expect(save).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByLabelText("Remove Alpha from Personal"));
  expect(save).toHaveBeenLastCalledWith([workspace]);
});
it("edits names and colors and confirms deletion of only the workspace", () => {
  const save = vi.fn().mockResolvedValue(true);
  render(<WorkspaceSettings projects={[project]} workspaces={[workspace]} disabled={false} onSave={save}/>);
  const name = screen.getByLabelText("Name for Personal");
  fireEvent.change(name, { target: { value: "Renamed" } }); fireEvent.blur(name);
  expect(save).toHaveBeenLastCalledWith([{ ...workspace, name: "Renamed" }]);
  expect(screen.queryByLabelText("Color for Personal")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose color for personal" }));
  fireEvent.change(screen.getByLabelText("Color for Personal"), { target: { value: "#123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply color" }));
  expect(save).toHaveBeenLastCalledWith([{ ...workspace, color: "#123456" }]);
  fireEvent.click(screen.getByRole("button", { name: "Delete workspace Personal" }));
  fireEvent.click(screen.getByText("Delete workspace"));
  expect(save).toHaveBeenLastCalledWith([]);
});
it("assigns an unassigned project on pointer release over a workspace and ignores canceled/outside drags", () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const save = vi.fn().mockResolvedValue(true);
  render(<WorkspaceSettings projects={[project]} workspaces={[workspace]} disabled={false} onSave={save}/>);
  const source = within(screen.getByRole('region', { name: 'No workspace' })).getByText('Alpha');
  source.setPointerCapture = vi.fn();
  const target = screen.getByRole('region', { name: 'Personal workspace' });
  const hit = vi.fn((): Element | null => target);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(source, { clientX: 100, clientY: 200 });
  expect(target.classList.contains('workspace-drop-target')).toBe(true);
  fireEvent.pointerUp(source, { clientX: 100, clientY: 200 });
  expect(save).toHaveBeenCalledExactlyOnceWith([{ ...workspace, projects: ['p'] }]);
  expect(target.classList.contains('workspace-drop-target')).toBe(false);
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(source, { clientX: 100, clientY: 200 });
  fireEvent.pointerCancel(source);
  fireEvent.pointerUp(source, { clientX: 100, clientY: 200 });
  expect(save).toHaveBeenCalledTimes(1);
  hit.mockReturnValue(null);
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(source, { clientX: 100, clientY: 200 });
  fireEvent.pointerUp(source, { clientX: 100, clientY: 200 });
  expect(save).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'elementFromPoint');
});
it("moves workspaces with the keyboard, preserving membership and respecting boundaries and disabled editing", () => {
  const save = vi.fn().mockResolvedValue(true);
  const second = { ...workspace, id: "w2", name: "Work", projects: ["p"] };
  const view = render(<WorkspaceSettings projects={[project]} workspaces={[workspace, second]} disabled={false} onSave={save}/>);
  const handle = screen.getByRole("button", { name: "Reorder workspace Personal" });
  fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: "ArrowDown", altKey: true });
  expect(save).toHaveBeenCalledExactlyOnceWith([second, workspace]);
  view.rerender(<WorkspaceSettings projects={[project]} workspaces={[second, workspace]} disabled={false} onSave={save}/>);
  fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
  expect(save).toHaveBeenLastCalledWith([workspace, second]);
  view.rerender(<WorkspaceSettings projects={[project]} workspaces={[second, workspace]} disabled={true} onSave={save}/>);
  fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
  expect(save).toHaveBeenCalledTimes(2);
});
it("inserts a dragged workspace before or after a card and ignores canceled and outside drops", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const save = vi.fn().mockResolvedValue(true);
  const second = { ...workspace, id: "w2", name: "Work", projects: ["p"] };
  render(<WorkspaceSettings projects={[project]} workspaces={[workspace, second]} disabled={false} onSave={save}/>);
  const handle = screen.getByRole("button", { name: "Reorder workspace Personal" });
  handle.setPointerCapture = vi.fn();
  const target = screen.getByRole("region", { name: "Work workspace" });
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 100, height: 100 } as DOMRect);
  const hit = vi.fn((): Element | null => target);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  try {
    fireEvent.pointerDown(handle, { button: 0 });
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 190 });
    expect(target.classList.contains("project-reorder-after")).toBe(true);
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 190 });
    expect(save).toHaveBeenCalledExactlyOnceWith([second, workspace]);
    fireEvent.pointerDown(handle, { button: 0 });
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 110 });
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle, { button: 0 });
    fireEvent.pointerCancel(handle);
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 190 });
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle, { button: 0 });
    hit.mockReturnValue(null);
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 190 });
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "elementFromPoint");
  }
});

it("moves a member by touch between workspaces, preserves unrelated memberships, and unassigns projects", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const save = vi.fn().mockResolvedValue(true);
  const first = { ...workspace, projects: ["p"] };
  const second = { ...workspace, id: "w2", name: "Work", projects: [] };
  const third = { ...workspace, id: "w3", name: "Shared", projects: ["p"] };
  const view = render(<WorkspaceSettings projects={[project]} workspaces={[first, second, third]} disabled={false} onSave={save}/>);
  const handle = screen.getByRole("button", { name: "Move Alpha from Personal" });
  handle.setPointerCapture = vi.fn();
  const hit = vi.fn((): Element | null => screen.getByRole("region", { name: "Work workspace" }));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  try {
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 200 });
    expect(save).toHaveBeenLastCalledWith([workspace, { ...second, projects: ["p"] }, third]);
    hit.mockImplementation(() => screen.getByRole("region", { name: "No workspace" }));
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 200 });
    expect(save).toHaveBeenLastCalledWith([workspace, second, { ...third, projects: [] }]);
    expect(screen.queryByRole("combobox")).toBeNull();
    view.rerender(<WorkspaceSettings projects={[project]} workspaces={[first, second, third]} disabled={true} onSave={save}/>);
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 200 });
    expect(save).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); Reflect.deleteProperty(document, "elementFromPoint"); }
});

it("keeps the picker open after adding, searches, and returns to the workspace with Done", async () => {
  const save = vi.fn().mockResolvedValue(true);
  const other = { ...project, id: 'b', name: 'Beta' };
  const view = render(<WorkspaceSettings projects={[project, other]} workspaces={[workspace]} disabled={false} onSave={save}/>);
  fireEvent.click(screen.getByText('Add projects'));
  const sheet = screen.getByRole('dialog', { name: 'Add projects to Personal' });
  fireEvent.change(within(sheet).getByLabelText('Search projects'), { target: { value: 'alp' } });
  expect(within(sheet).queryByRole('button', { name: 'Beta' })).toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Alpha' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  view.rerender(<WorkspaceSettings projects={[project, other]} workspaces={[{ ...workspace, projects: ['p'] }]} disabled={false} onSave={save}/>);
  expect(within(sheet).getByRole('button', { name: 'Alpha, added' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(sheet).getByLabelText('Search projects'), { target: { value: 'zzz' } });
  expect(within(sheet).getByText('No projects match “zzz”.')).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it("shows failed saves inside the sheet and permits retry without losing the selection flow", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(true);
  render(<WorkspaceSettings projects={[project]} workspaces={[workspace]} disabled={false} onSave={save}/>);
  fireEvent.click(screen.getByText('Add projects'));
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Connection lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
