import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@freddai/shared/agent/types";
import type { ScoutActions } from "../contracts";
import type { Item, Project, ScoutState } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@freddai/shared/agent/client", () => ({
  launchThread: vi.fn(async () => "s-new"),
  queueMessage: vi.fn(async () => undefined),
  respond: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}));
vi.mock("@freddai/shared/voice/VoiceControls", () => ({ MicButton: () => <button type="button">Dictate</button> }));
vi.mock("@freddai/app/conversation/ThreadTranscript", () => ({
  ThreadTranscript: ({ children }: { children?: unknown }) => <div data-testid="transcript">{children as never}</div>,
}));

import { launchThread } from "@freddai/shared/agent/client";
import { ItemThread } from "./ItemThread";

afterEach(cleanup);

const project = (patch: Partial<Project> = {}): Project => ({
  id: "sp1", workspace: "w1", name: "Sales", color: "#3b6cf6", order: 0, pinned: false, hidden: false, freddai_project: null, ...patch,
});
const item: Item = {
  id: "i1", project: "sp1", kind: "email", title: "Re: Pricing for 40 seats", subtitle: "jordan@acme.example",
  lane: "focus", status: "needs_you", source: null, origin: "user", thread: null, order: 0,
  created: "2026-11-13T10:00:00Z", updated: "2026-11-13T10:00:00Z", done_at: null,
};
const state = (p: Project): ScoutState => ({
  revision: 1,
  workspaces: [{ id: "w1", name: "LiveCase", color: "#3b6cf6", order: 0, collapsed: false }],
  projects: [p], items: [item], rules: [], sources: [],
  settings: { onboarding_done: true, onboarding_step: 5, sample_data: false },
});
const db: Database = {
  accounts: [{ id: "a1", name: "Work", provider: "claude", color: "#d97757" }],
  projects: [{ id: "fp1", name: "Freddai", path: "/code/freddai", color: "#000", policy: "fixed", account: "a1", last: null }],
  sessions: [], preferences: { prefer_last: false, fallback: "a1", last: null },
};
const cmdDb: Database = { ...db, projects: [...db.projects, { id: "cmd", name: "Commander", path: "/code/cmd", color: "#111", policy: "fixed", account: "a1", last: null, kind: "commander" } as Database["projects"][number]] };
const actions = () => {
  return new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, { get: (target, key: string) => (target[key] ??= vi.fn(async () => undefined)) }) as unknown as ScoutActions & Record<string, ReturnType<typeof vi.fn>>;
};

describe("ItemThread", () => {
  it("shows the composer for an unlinked project when a Commander project exists", () => {
    render(<ItemThread state={state(project())} db={cmdDb} actions={actions()} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.queryByText("Link this project to a Freddai project to chat")).toBeNull();
  });

  it("shows the link notice above a disabled composer when there is no link and no Commander project", () => {
    const a = actions();
    render(<ItemThread state={state(project())} db={db} actions={a} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByText("Link this project to a Freddai project to chat")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Freddai project" }), { target: { value: "fp1" } });
    fireEvent.click(screen.getByRole("button", { name: "Link a Freddai project" }));
    expect(a.projectSave).toHaveBeenCalledWith(expect.objectContaining({ id: "sp1", freddai_project: "fp1" }));
  });

  it("renders the composer when the project is linked", () => {
    render(<ItemThread state={state(project({ freddai_project: "fp1" }))} db={db} actions={actions()} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.queryByText("Link this project to a Freddai project to chat")).toBeNull();
    expect(screen.getByText("Claude · Work")).toBeTruthy();
  });

  const task: Item = { ...item, kind: "task" };
  it("the task checkbox marks the item done", () => {
    const a = actions();
    render(<ItemThread state={{ ...state(project({ freddai_project: "fp1" })), items: [task] }} db={db} actions={a} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done" }));
    expect(a.itemMove).toHaveBeenCalledWith("i1", "done", 0);
  });

  it("the checked task checkbox reopens the item", () => {
    const a = actions();
    render(<ItemThread state={{ ...state(project({ freddai_project: "fp1" })), items: [{ ...task, lane: "done" }] }} db={db} actions={a} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark not done" }));
    expect(a.itemMove).toHaveBeenCalledWith("i1", "focus", 0);
  });

  it("the pin button reflects and toggles the lane", () => {
    const a = actions();
    render(<ItemThread state={state(project({ freddai_project: "fp1" }))} db={db} actions={a} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    const pin = screen.getByRole("button", { name: "Unpin" });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pin);
    expect(a.itemMove).toHaveBeenCalledWith("i1", "backlog", 0);
  });

  const session = (patch: Record<string, unknown> = {}) => ({
    id: "s9", project: "fp1", account: "a1", title: "t", status: "idle", updated: 1, provider_id: null,
    messages: [], pending: null, error: null, ...patch,
  }) as unknown as Database["sessions"][number];
  const threaded = (patch: Partial<Item> = {}): ScoutState => ({ ...state(project({ freddai_project: "fp1" })), items: [{ ...item, thread: "s9", ...patch }] });
  const withSession = (s: Database["sessions"][number]): Database => ({ ...db, sessions: [s] });

  it("derives the status from the live session", () => {
    const props = { actions: actions(), itemId: "i1", onClose: vi.fn(), onOpenProject: vi.fn() };
    const { rerender } = render(<ItemThread state={threaded()} db={withSession(session({ pending: { id: "r" } }))} {...props} />);
    expect(screen.getByText("Needs you")).toBeTruthy();
    rerender(<ItemThread state={threaded()} db={withSession(session({ status: "running" }))} {...props} />);
    expect(screen.queryByText("Needs you")).toBeNull();
    expect(screen.getByText("Working")).toBeTruthy();
    rerender(<ItemThread state={threaded()} db={withSession(session())} {...props} />);
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("falls back to the stored status when the session is missing", () => {
    render(<ItemThread state={threaded()} db={db} actions={actions()} itemId="i1" onClose={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByText("Needs you")).toBeTruthy();
  });

  const sendFirst = async (a: ReturnType<typeof actions>, st: ScoutState, release?: () => void) => {
    const props = { db, actions: a, itemId: "i1", onClose: vi.fn(), onOpenProject: vi.fn() };
    const view = render(<ItemThread state={st} {...props} />);
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    return { view, props, box, release };
  };

  it("saves the thread onto the latest item, keeping changes made during the launch", async () => {
    let finish!: (id: string) => void;
    vi.mocked(launchThread).mockImplementationOnce(() => new Promise<string>(r => { finish = r; }));
    const a = actions();
    const st = state(project({ freddai_project: "fp1" }));
    const { view, props } = await sendFirst(a, st);
    const changed: ScoutState = { ...st, items: [{ ...item, lane: "backlog", title: "Renamed" }] };
    view.rerender(<ItemThread state={changed} {...props} />);
    await act(async () => { finish("s-new"); });
    await waitFor(() => expect(a.itemSave).toHaveBeenCalled());
    expect(a.itemSave).toHaveBeenCalledWith(expect.objectContaining({ id: "i1", lane: "backlog", title: "Renamed", thread: "s-new" }));
  });

  it("reports a link failure without reporting the send as failed", async () => {
    vi.mocked(launchThread).mockResolvedValueOnce("s-new");
    const a = actions();
    vi.mocked(a.itemSave).mockRejectedValueOnce(new Error("disk full"));
    const { box } = await sendFirst(a, state(project({ freddai_project: "fp1" })));
    expect((await screen.findByRole("alert")).textContent).toContain("Message sent, but linking the thread failed");
    expect(screen.getByRole("alert").textContent).toContain("disk full");
    expect(box.value).toBe("");
  });
});
