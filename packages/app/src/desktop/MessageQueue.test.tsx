import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageQueue } from "./MessageQueue";
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);
const queue = { session: "t", paused: false, error: null, messages: [{ id: "q1", prompt: "Change direction", options: { attachments: ["file"] } }] };
it("offers steer, edit, and delete for a queued message", async () => {
  const onAction = vi.fn();
  render(<MessageQueue queue={queue} active disabled={false} canSteer onAction={onAction}/>);
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByText("Clear queue")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Steer instead" }));
  expect(onAction).toHaveBeenCalledWith("steer", "q1");
  await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
  const editor = screen.getByRole("textbox", { name: "Edit queued message" });
  await userEvent.clear(editor);
  await userEvent.type(editor, "Revised direction");
  await userEvent.click(screen.getByRole("button", { name: "Save queued message" }));
  expect(onAction).toHaveBeenCalledWith("edit", "q1", "Revised direction");
});
it("disables steer when there is no supported active turn", () => {
  render(<MessageQueue queue={queue} active={false} disabled={false} canSteer={false} onAction={vi.fn()}/>);
  expect((screen.getByRole("button", { name: "Steer instead" }) as HTMLButtonElement).disabled).toBe(true);
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
