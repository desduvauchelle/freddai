import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageQueue } from "./MessageQueue";
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);
const queue = { session: "t", paused: false, error: null, messages: [{ id: "q1", prompt: "Change direction", options: { attachments: ["file"] } }] };
it("offers steer, edit, and delete for a queued message", async () => {
  const onAction = vi.fn();
  render(<MessageQueue queue={queue} active disabled={false} canSteer onAction={onAction}/>);
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByText(/Clear/)).toBeNull();
  expect(screen.getAllByRole("button").map(b => b.getAttribute("aria-label"))).toEqual(["Steer instead", "Edit queued message", "Delete queued message: Change direction"]);
  expect(screen.getAllByRole("button").every(b => !b.textContent?.trim())).toBe(true);
  expect(screen.queryByText("Steer")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Steer instead" }));
  expect(onAction).toHaveBeenCalledWith("steer", "q1");
  await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
  const editor = screen.getByRole("textbox", { name: "Edit queued message" });
  await userEvent.clear(editor);
  await userEvent.type(editor, "Revised direction");
  await userEvent.click(screen.getByRole("button", { name: "Save queued message" }));
  expect(onAction).toHaveBeenCalledWith("edit", "q1", "Revised direction");
});
it("lets an idle paused queue send without requiring steering support", async () => {
  const onAction = vi.fn();
  render(<MessageQueue queue={{ ...queue, paused: true }} active={false} disabled={false} canSteer={false} onAction={onAction}/>);
  expect(screen.getByRole("status").textContent).toContain("Paused");
  await userEvent.click(screen.getByRole("button", { name: "Send now" }));
  expect(onAction).toHaveBeenCalledWith("resume", undefined);
});

it("retains unsaved edits on failure and lets Cancel restore the preview", async () => {
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(<MessageQueue queue={queue} active disabled={false} canSteer onAction={onAction}/>);
  await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
  const editor = screen.getByRole("textbox", { name: "Edit queued message" }) as HTMLTextAreaElement;
  await userEvent.clear(editor); await userEvent.type(editor, "Keep this draft");
  await userEvent.click(screen.getByRole("button", { name: "Save queued message" }));
  expect(editor.value).toBe("Keep this draft");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onAction).toHaveBeenCalledTimes(1);
});
it("hides background wakes while preserving queued user messages", () => {
  const messages = [
    { id: "commander-heartbeat-1", prompt: "Heartbeat (scheduled check-in, not a user message). Review stuff.", options: {} },
    { id: "commander-wake-1", prompt: "Delegated thread finished", options: {} },
    { id: "commander-completions-1", prompt: "Legacy completion", options: {} },
  ];
  const { container, rerender } = render(<MessageQueue queue={{ ...queue, messages }} active disabled={false} canSteer onAction={vi.fn()}/>);
  expect(container.textContent).toBe("");
  rerender(<MessageQueue queue={{ ...queue, messages: [...messages, ...queue.messages] }} active disabled={false} canSteer onAction={vi.fn()}/>);
  expect(screen.getByText("Change direction")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});

it("strips the voice suffix with a badge and shows delete errors", async () => {
  const onAction = vi.fn().mockRejectedValueOnce(new Error("boom"));
  const voice = { ...queue, messages: [
    { id: "a", prompt: "hello there\n\n<voice-call>Live voice call. Start</voice-call>", options: {} },
    { id: "b", prompt: "second", options: {} }] };
  render(<MessageQueue queue={{ ...voice, error: "queue broke" }} active disabled canSteer onAction={onAction}/>);
  expect(screen.getByText("voice")).toBeTruthy();
  expect(screen.queryByText(/Live voice call/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Clear all/ })).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("queue broke");
  await userEvent.click(screen.getByRole("button", { name: /^Delete queued message: hello there/ }));
  expect(onAction).toHaveBeenCalledWith("delete", "a");
  expect(screen.getByRole("alert").textContent).toContain("boom");
});

it("keeps a removed row mounted as inert while it animates out, then unmounts it", () => {
  vi.useFakeTimers();
  try {
    const two = { ...queue, messages: [{ id: "a", prompt: "first", options: {} }, { id: "b", prompt: "second", options: {} }] };
    const { container, rerender } = render(<MessageQueue queue={two} active disabled={false} canSteer onAction={vi.fn()}/>);
    rerender(<MessageQueue queue={{ ...two, messages: [two.messages[1]] }} active disabled={false} canSteer onAction={vi.fn()}/>);
    const leaving = container.querySelector("li.message-queue-leaving") as HTMLElement;
    expect(leaving.textContent).toContain("first");
    expect(leaving.getAttribute("aria-hidden")).toBe("true");
    expect([...leaving.querySelectorAll("button")].every(b => b.disabled)).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector("li.message-queue-leaving")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    rerender(<MessageQueue queue={{ ...two, messages: [] }} active disabled={false} canSteer onAction={vi.fn()}/>);
    expect(container.querySelector("section.message-queue-leaving")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.innerHTML).toBe("");
  } finally { vi.useRealTimers(); }
});
