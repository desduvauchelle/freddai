import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "./types";
import { ConversationActivity } from "./MascotScenes";

vi.mock("./Dormouse", () => ({ Dormouse: ({ mood }: { mood: number }) => <div data-testid="character" data-mood={mood} /> }));
afterEach(cleanup);
const thread: Session = { id: "activity", title: "Synthetic thread", project: "p", account: "a", status: "starting", updated: 1, provider_id: null, messages: [], pending: null, error: null };

it("follows launch, work, input, resume and completion without leaving a loader behind", () => {
  const view = render(<ConversationActivity thread={thread} />);
  expect(screen.getByRole("status").textContent).toBe("Starting…");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "running" }} />);
  expect(screen.getByRole("status").textContent).toBe("Working…");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("2");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "waiting" }} />);
  expect(screen.getByRole("status").textContent).toBe("Waiting for your input…");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("4");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "running" }} />);
  expect(screen.getByRole("status").textContent).toBe("Working…");
  for (const status of ["done", "idle"] as const) {
    view.rerender(<ConversationActivity thread={{ ...thread, status }} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("character")).toBeNull();
  }
});

it("shows an input request even while running and keeps split panes independent", () => {
  const pending = {} as NonNullable<Session["pending"]>;
  render(<><ConversationActivity thread={{ ...thread, status: "running", pending }} /><ConversationActivity thread={{ ...thread, id: "other", status: "running" }} /></>);
  expect(screen.getAllByRole("status").map(el => el.textContent)).toEqual(["Waiting for your input…", "Working…"]);
  expect(screen.getAllByTestId("character").map(el => el.getAttribute("data-mood"))).toEqual(["4", "2"]);
});

it("replaces working with an accurate interrupted or failure state", () => {
  const view = render(<ConversationActivity thread={{ ...thread, status: "interrupted" }} />);
  expect(screen.getByRole("status").textContent).toBe("Interrupted");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("7");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "failed" }} />);
  expect(screen.getByRole("status").textContent).toBe("Needs attention");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("8");
});

it("tracks dispatch time across updates and waiting, resets per turn and hides on completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  try {
    const active = { ...thread, status: "running", turn_started_at: 35_000, usage: { context_tokens: 1234, context_window: null, input_tokens: null, cached_input_tokens: null } };
    const view = render(<ConversationActivity thread={active} />);
    expect(screen.getByText("1m 5s elapsed")).toBeTruthy();
    expect(screen.getByText("1,234 context tokens")).toBeTruthy();
    view.rerender(<ConversationActivity thread={{ ...active, status: "waiting", updated: 100_000, last_user_message_at: 99_000 }} />);
    expect(screen.getByText("1m 5s elapsed")).toBeTruthy();
    view.rerender(<ConversationActivity thread={{ ...active, turn_started_at: 100_000 }} />);
    expect(screen.getByText("0s elapsed")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("2s elapsed")).toBeTruthy();
    view.rerender(<ConversationActivity thread={{ ...active, status: "done" }} />);
    expect(screen.queryByText(/elapsed/)).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("keeps Stop and Resume scoped to their own conversation panes", () => {
  const stopLeft = vi.fn(), resumeRight = vi.fn();
  render(<><ConversationActivity thread={{ ...thread, status: "running" }} onStop={stopLeft} />
    <ConversationActivity thread={{ ...thread, id: "right", status: "interrupted" }} onResume={resumeRight} /></>);
  fireEvent.click(screen.getByRole("button", { name: /Stop current turn/ }));
  expect(stopLeft).toHaveBeenCalledOnce();
  expect(resumeRight).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(resumeRight).toHaveBeenCalledOnce();
});
