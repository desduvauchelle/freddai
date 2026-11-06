// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThreadTranscript } from "./ThreadTranscript";
import { TodoPanel } from "./TodoList";
import { latestTodos } from "./todos";

const file = { id: "f1", name: "notes.txt", mime: "text/plain", bytes: 12, sha256: "x" };
afterEach(cleanup);

describe("ThreadTranscript", () => {
  it("renders user bubbles with attachments, assistant markdown and grouped tool activity", () => {
    const { container } = render(<ThreadTranscript messages={[
      { id: "1", role: "user", text: "Fix the bug", attachments: [file] },
      { id: "2", role: "assistant", text: "Here is **bold** and `code`." },
      { id: "3", role: "tool", text: "Bash ls" },
      { id: "4", role: "tool", text: "Read a.ts" },
    ]} />);
    const user = screen.getByLabelText("Your message");
    expect(user.className).toBe("chat-user");
    expect(user.textContent).toContain("Fix the bug");
    expect(user.querySelector(".attachment-chip")?.textContent).toBe("notes.txt");
    const assistant = screen.getByLabelText("Assistant message");
    expect(assistant.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("details.tool-activity")).toHaveLength(1);
    expect(screen.getByText(/Tool activity · 2 calls/)).toBeTruthy();
    // No role labels on any density.
    expect(container.querySelector("article > small")).toBeNull();
  });

  it("shows pending outgoing messages with their status line", () => {
    render(<ThreadTranscript messages={[]} pending={[{ id: "p1", text: "Queued thing", attachments: [file], status: "Queued on your Mac" }]} />);
    const pending = screen.getByLabelText("Your message");
    expect(pending.textContent).toContain("Queued thing");
    expect(pending.querySelector("[role=status]")?.textContent).toBe("Queued on your Mac");
  });

  it("applies the density attribute and renders trailing children", () => {
    const { container, rerender } = render(<ThreadTranscript messages={[]} density="compact"><p role="alert">Boom</p></ThreadTranscript>);
    expect(container.querySelector(".thread-transcript")?.getAttribute("data-density")).toBe("compact");
    expect(screen.getByRole("alert").textContent).toBe("Boom");
    rerender(<ThreadTranscript messages={[]} />);
    expect(container.querySelector(".thread-transcript")?.getAttribute("data-density")).toBe("comfortable");
  });
});

describe("ThreadTranscript background sub-agents", () => {
  it("keeps sub-agents beside their launch when later replies and pending messages arrive", () => {
    const messages = [
      { id: "u1", role: "user", text: "Build it" },
      { id: "launch", role: "tool", text: JSON.stringify({ type: "tool_use", id: "tu1", name: "Agent", input: { description: "Write docs" } }) },
      { id: "a1", role: "assistant", text: "Done building" },
      { id: "u2", role: "user", text: "Server is not running" },
    ];
    const tasks = [{ id: "agent1", tool_use_id: "tu1", description: "Write docs", status: "running" }];
    const { container, rerender } = render(<ThreadTranscript messages={messages} tasks={tasks} pending={[{ id: "p", text: "Another reply" }]} />);
    const order = () => [...container.querySelector(".thread-transcript")!.children].map(el => el.textContent);
    expect(order().findIndex(t => t?.includes("Write docs"))).toBeLessThan(order().findIndex(t => t === "Done building"));
    rerender(<ThreadTranscript messages={messages} tasks={[{ ...tasks[0], status: "completed" }]} />);
    expect(order().findIndex(t => t?.includes("Completed"))).toBeLessThan(order().findIndex(t => t === "Server is not running"));
  });

  it("restores separate launch groups in compact threads without duplicating or hiding unmatched tasks", () => {
    const launch = (id: string) => ({ id, role: "tool", text: JSON.stringify({ type: "tool_use", id, name: "Agent" }) });
    const { container } = render(<ThreadTranscript density="compact" messages={[
      launch("first"), { id: "reply", role: "user", text: "Next request" }, launch("second"),
      { id: "end", role: "assistant", text: "Finished" },
    ]} tasks={[
      { id: "a", tool_use_id: "first", description: "First agent", status: "completed" },
      { id: "b", tool_use_id: "second", description: "Second agent", status: "running" },
      { id: "legacy", description: "Legacy agent", status: "stopped" },
    ]} />);
    const children = [...container.querySelector(".thread-transcript")!.children];
    expect(children.map(el => el.className)).toEqual(["tool-activity", "background-tasks", "chat-user", "tool-activity", "background-tasks", "chat-assistant", "background-tasks"]);
    expect(children[1].textContent).toContain("First agent");
    expect(children[4].textContent).toContain("Second agent");
    expect(container.querySelectorAll(".background-tasks li")).toHaveLength(3);
    expect(container.querySelector("details .background-tasks")).toBeNull();
  });

  it("shows each sub-agent as its own visible row with live status, outside tool activity", () => {
    const { container, rerender } = render(<ThreadTranscript messages={[{ id: "t", role: "tool", text: "Agent call" }]} tasks={[
      { id: "a", description: "Show subagents", kind: "general-purpose", status: "running" },
      { id: "b", description: "Write tests", status: "failed", summary: "Agent process ended" },
    ]} />);
    const rows = container.querySelectorAll(".background-tasks li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Show subagents");
    expect(rows[0].textContent).toContain("general-purpose");
    expect(rows[0].textContent).toContain("Running");
    expect(rows[1].textContent).toContain("Failed");
    expect(screen.getByText("1 of 2 sub-agents running")).toBeTruthy();
    expect(container.querySelector("details .background-tasks")).toBeNull();
    rerender(<ThreadTranscript messages={[]} tasks={[{ id: "a", description: "Show subagents", status: "completed" }]} />);
    expect(container.querySelector(".background-tasks li")?.textContent).toContain("Completed");
    rerender(<ThreadTranscript messages={[]} />);
    expect(container.querySelector(".background-tasks")).toBeNull();
  });
});

const todoCall = (todos: unknown[]) => JSON.stringify({ type: "tool_use", name: "TodoWrite", input: { todos } });
const todos = [
  { content: "Read code", status: "completed", activeForm: "Reading code" },
  { content: "Write fix", status: "in_progress", activeForm: "Writing fix" },
  { content: "Run tests", status: "pending", activeForm: "Running tests" },
];

describe("ThreadTranscript reasoning", () => {
  it("shows thinking collapsed, live while active and last, then settles", () => {
    const messages = [{ id: "r", role: "reasoning", text: "Weighing options" }];
    const { container, rerender } = render(<ThreadTranscript messages={messages} active />);
    const block = container.querySelector("details.reasoning-block") as HTMLDetailsElement;
    expect(block.open).toBe(false);
    expect(block.querySelector("summary")?.textContent).toBe("Thinking…");
    expect(block.textContent).toContain("Weighing options");
    rerender(<ThreadTranscript messages={[...messages, { id: "a", role: "assistant", text: "Done" }]} active />);
    expect(container.querySelector(".reasoning-block summary")?.textContent).toMatch(/^Thought( for \d+s)?$/);
    expect(container.querySelector(".reasoning-block")?.getAttribute("data-live")).toBe("false");
  });
  it("hides empty reasoning", () => {
    const { container } = render(<ThreadTranscript messages={[{ id: "r", role: "reasoning", text: "  " }]} />);
    expect(container.querySelector(".reasoning-block")).toBeNull();
  });
});

describe("todo list", () => {
  it("renders the TodoWrite tool row as a checklist instead of raw JSON", async () => {
    const { container } = render(<ThreadTranscript messages={[{ id: "t", role: "tool", text: todoCall(todos) }]} />);
    const group = container.querySelector<HTMLDetailsElement>("details.tool-activity")!;
    group.open = true; fireEvent(group, new Event("toggle"));
    const summary = await screen.findByText("Call 1 · Task list");
    const call = summary.closest("details")!;
    call.open = true; fireEvent(call, new Event("toggle"));
    await waitFor(() => expect(container.querySelectorAll(".tool-activity-call .todo-list li")).toHaveLength(3));
    const items = container.querySelectorAll(".tool-activity-call .todo-list li");
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute("data-status")).toBe("completed");
    expect(items[1].textContent).toBe("Writing fix");
    expect(container.querySelector(".tool-activity-call pre")).toBeNull();
  });
  it("pins the latest todo state, shows progress, and hides once finished and idle", () => {
    const first = { id: "t1", role: "tool", text: todoCall([{ content: "Read code", status: "pending", activeForm: "Reading code" }]) };
    const latest = { id: "t2", role: "tool", text: todoCall(todos) };
    expect(latestTodos([first, latest, { id: "x", role: "tool", text: "Bash ls" }])).toHaveLength(3);
    const { container, rerender } = render(<TodoPanel messages={[first, latest]} active />);
    expect(container.querySelector(".todo-panel summary")?.textContent).toContain("Tasks · 1/3 done");
    expect(container.querySelector(".todo-panel summary small")?.textContent).toBe("Writing fix");
    const done = { id: "t3", role: "tool", text: todoCall(todos.map(t => ({ ...t, status: "completed" }))) };
    rerender(<TodoPanel messages={[first, latest, done]} active={false} />);
    expect(container.querySelector(".todo-panel")).toBeNull();
    rerender(<TodoPanel messages={[{ id: "n", role: "tool", text: "not json" }]} active />);
    expect(container.querySelector(".todo-panel")).toBeNull();
  });
});
