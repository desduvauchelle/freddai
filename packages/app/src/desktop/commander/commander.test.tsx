import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../types";
import type { CommanderState, Proposal, Todo } from "./api";

const api = vi.hoisted(() => ({
  state: vi.fn(), todos: vi.fn(), todoSave: vi.fn(), notes: vi.fn(), noteRead: vi.fn(), noteWrite: vi.fn(),
  proposals: vi.fn(), proposalRespond: vi.fn(), memory: vi.fn(), memorySave: vi.fn(), objectiveSet: vi.fn(), settingsSet: vi.fn(),
}));
vi.mock("./api", () => ({ commanderApi: api }));
vi.mock("../Dormouse", () => ({ Dormouse: ({ label }: { label: string }) => <div data-testid="dormouse" aria-label={label} /> }));
vi.mock("../VoiceControls", () => ({
  MicButton: ({ onText, label }: { onText: (t: string, b: HTMLElement) => void; label?: string }) => <button type="button" aria-label={label ?? "Dictate"} onClick={e => onText("spoken words", e.currentTarget)} />,
}));
vi.mock("../voice", () => ({ useVoice: () => ({ status: { ready: true }, phase: "idle" }) }));

import { CommanderCluster } from "./CommanderCluster";
import { CommanderView } from "./CommanderView";
import { CommanderTrailingContext } from "./TrailingContext";
import { ApprovalCard } from "./ApprovalCard";
import { CommanderTools, groupTodos } from "./CommanderTools";
import { ProjectObjective } from "./ProjectObjective";
import { LAST_VISIT_KEY, awayCards } from "./away";

const project = (id: string, name: string, over: Partial<Project> = {}): Project => ({ id, name, path: `/p/${id}`, color: "#888", policy: "inherit", account: null, last: null, ...over });
const projects = [project("cmd", "Commander", { kind: "commander" }), project("alpha", "Alpha"), project("beta", "Beta")];
const state = (over: Partial<CommanderState> = {}): CommanderState => ({
  project: { id: "cmd", name: "Commander", path: "/c", objective: null, account: null, model: null }, thread_id: null, status: { needs_you: 1, running: 0, done_today: 2 }, ...over,
});
const todo = (id: string, over: Partial<Todo> = {}): Todo => ({
  id, title: `Todo ${id}`, description: null, project: "alpha", owner: "me", thread: null, status: "open", due: null, check_back_at: null, verification: [],
  completion_basis: null, completion_note: null, created_at: "2026-11-07T10:00:00Z", updated_at: "2026-11-07T10:00:00Z", history: [], ...over,
});
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1", tool: "freddai_start_task", summary: "Start the pricing page", project: "alpha", arguments: { prompt: "Build pricing" }, status: "pending",
  result: null, error: null, thread: null, created_at: "2026-11-07T10:00:00Z", decided_at: null, ...over,
});

beforeEach(() => {
  localStorage.clear();
  api.state.mockResolvedValue(state()); api.todos.mockResolvedValue([]); api.proposals.mockResolvedValue([]);
  api.notes.mockResolvedValue([]); api.memory.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("cluster renders avatar, mic and plus controls, and the avatar opens the view", async () => {
  const onOpen = vi.fn(), onSend = vi.fn(async () => {});
  render(<CommanderCluster onOpen={onOpen} onSend={onSend} />);
  const avatar = await screen.findByRole("button", { name: "Open Commander" });
  expect(screen.getByRole("button", { name: "Dictate to Commander" })).toBeTruthy();
  const plus = screen.getByRole("button", { name: "Message Commander" });
  expect(await screen.findByText("1 needs you")).toBeTruthy();
  fireEvent.click(avatar);
  expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Dictate to Commander" }));
  await waitFor(() => expect(onSend).toHaveBeenCalledWith("spoken words"));
  fireEvent.click(plus);
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('textbox')).toBeNull();
});

it("cluster shows send failures loudly", async () => {
  render(<CommanderCluster onOpen={vi.fn()} onSend={vi.fn(async () => { throw new Error("no account"); })} />);
  fireEvent.click(await screen.findByRole("button", { name: "Dictate to Commander" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no account");
});

it("approval Yes calls respond, No declines, edited prompt is sent, errors render", async () => {
  api.proposalRespond.mockResolvedValueOnce(proposal({ status: "approved", result: "Started", thread: "t9" }));
  const onOpenThread = vi.fn();
  const { unmount } = render(<ApprovalCard proposal={proposal()} projectName="Alpha" onOpenThread={onOpenThread} />);
  expect(screen.getByText("Alpha")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Task prompt"), { target: { value: "Build pricing v2" } });
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(api.proposalRespond).toHaveBeenCalledWith("p1", true, "Build pricing v2"));
  fireEvent.click(await screen.findByRole("button", { name: /Open thread/ }));
  expect(onOpenThread).toHaveBeenCalledWith("t9");
  unmount();

  api.proposalRespond.mockResolvedValueOnce(proposal({ status: "failed", error: "Project folder is missing" }));
  render(<ApprovalCard proposal={proposal()} />);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Project folder is missing");

  cleanup();
  api.proposalRespond.mockRejectedValueOnce(new Error("host offline"));
  render(<ApprovalCard proposal={proposal()} />);
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(api.proposalRespond).toHaveBeenLastCalledWith("p1", false, undefined);
  expect((await screen.findByRole("alert")).textContent).toContain("host offline");
});

it("to-dos are grouped by project with names", async () => {
  const todos = [todo("1", { project: "beta" }), todo("2", { project: "alpha" }), todo("3", { project: "alpha", owner: "commander" }), todo("4", { project: null })];
  expect(groupTodos(todos, projects).map(g => [g.name, g.todos.length])).toEqual([["Alpha", 2], ["Beta", 1], ["No project", 1]]);
  const data = { state: state(), proposals: [], todos, error: "", loaded: true, refresh: vi.fn(async () => {}) };
  render(<CommanderTools data={data} projects={projects} commanderId="cmd" initialTab="todos" onOpenThread={vi.fn()} onClose={vi.fn()} />);
  const alpha = screen.getByRole("region", { name: "To-dos for Alpha" });
  expect(within(alpha).getAllByRole("listitem").filter(li => li.classList.contains("commander-todo"))).toHaveLength(2);
  expect(screen.getByRole("region", { name: "To-dos for Beta" })).toBeTruthy();
  expect(within(alpha).getByText("Commander")).toBeTruthy();
  api.todoSave.mockResolvedValue(todo("2", { status: "done" }));
  fireEvent.click(within(alpha).getByRole("button", { name: 'Mark "Todo 2" done' }));
  await waitFor(() => expect(api.todoSave).toHaveBeenCalledWith({ id: "2", status: "done", completion_basis: "user_confirmed" }));
});

it("away block shows at most 3 cards and only after a >10 minute gap", async () => {
  const many = [
    ...Array.from({ length: 6 }, (_, i) => todo(`d${i}`, { status: "done", updated_at: new Date().toISOString() })),
    ...Array.from({ length: 6 }, (_, i) => todo(`r${i}`, { status: "needs_review" })),
    ...Array.from({ length: 6 }, (_, i) => todo(`o${i}`)),
  ];
  const props = [proposal({ id: "a" }), proposal({ id: "b" })];
  expect(awayCards(many, props, projects, Date.now() - 3600_000).length).toBeLessThanOrEqual(3);
  api.state.mockResolvedValue(state({ thread_id: null })); api.todos.mockResolvedValue(many); api.proposals.mockResolvedValue(props);
  const view = () => render(<CommanderView projects={projects} renderConversation={() => null} onSelectThread={vi.fn()} onOpenThread={vi.fn()} onNewThread={vi.fn(async () => {})} />);
  localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - 30 * 60_000));
  view();
  const away = await screen.findByRole("complementary", { name: "While you were away" });
  await waitFor(() => expect(within(away).getAllByRole("button").filter(b => b.classList.contains("commander-away-card")).length).toBe(3));
  cleanup();
  localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - 60_000));
  view();
  await screen.findAllByText("Commander");
  expect(screen.queryByRole("complementary", { name: "While you were away" })).toBeNull();
});

it("view pins pending proposals, offers Commander settings, and surfaces refresh errors", async () => {
  api.proposals.mockResolvedValue([proposal()]);
  render(<CommanderView projects={projects} renderConversation={() => null} onSelectThread={vi.fn()} onOpenThread={vi.fn()} onNewThread={vi.fn(async () => {})} />);
  expect(await screen.findByRole("article", { name: "Proposal: Start the pricing page" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  api.state.mockRejectedValue(new Error("host down"));
  await act(async () => { await new Promise(r => setTimeout(r, 3100)); });
  expect((await screen.findByRole("alert")).textContent).toContain("host down");
}, 10000);

it("objective save calls project_objective_set and reports failure", async () => {
  api.objectiveSet.mockResolvedValueOnce(undefined);
  const onSaved = vi.fn();
  render(<ProjectObjective projectId="alpha" objective="Old" onSaved={onSaved} />);
  const save = screen.getByRole("button", { name: "Save objective" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Ship pricing for SMBs" } });
  fireEvent.click(save);
  await waitFor(() => expect(api.objectiveSet).toHaveBeenCalledWith("alpha", "Ship pricing for SMBs"));
  expect(await screen.findByText("Saved")).toBeTruthy();
  api.objectiveSet.mockRejectedValueOnce(new Error("readonly"));
  fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
  expect((await screen.findByRole("alert")).textContent).toContain("readonly");
});

it("approved JSON results read as a human line, never raw JSON", async () => {
  api.proposalRespond.mockResolvedValueOnce(proposal({ status: "approved", result: '{"thread":"cb3cb075-309e-4054-8c4a-08463112d8dc"}', thread: "cb3cb075" }));
  render(<ApprovalCard proposal={proposal()} onOpenThread={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect((await screen.findByRole("status")).textContent).toBe("Started");
  expect(screen.queryByText(/cb3cb075-309e/)).toBeNull();
});

it("view hands proposal cards to the conversation to render inline after the messages", async () => {
  api.state.mockResolvedValue({ ...state(), thread_id: "t1" });
  api.proposals.mockResolvedValue([proposal()]);
  render(<CommanderView projects={projects} renderConversation={() => <div data-testid="conv"><CommanderTrailingContext.Consumer>{t => t}</CommanderTrailingContext.Consumer></div>} onSelectThread={vi.fn()} onOpenThread={vi.fn()} onNewThread={vi.fn(async () => {})} />);
  const card = await screen.findByRole("article", { name: "Proposal: Start the pricing page" });
  expect(within(screen.getByTestId("conv")).getByRole("article", { name: "Proposal: Start the pricing page" })).toBe(card);
});
