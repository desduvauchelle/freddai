import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentControls } from "./AgentControls";

afterEach(cleanup);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

async function openPicker() {
  render(<><AgentControls native={false} provider="claude" value={{ model: "", effort: "default" }} onChange={vi.fn()} /><textarea aria-label="Composer" /></>);
  const trigger = screen.getByLabelText("Model and effort");
  await userEvent.click(trigger);
  const details = trigger.closest("details")!;
  await waitFor(() => expect(details.open).toBe(true));
  return { trigger, details };
}

it("dismisses the model picker when clicking the composer outside it", async () => {
  const { details } = await openPicker();
  await userEvent.click(screen.getByLabelText("Composer"));
  await waitFor(() => expect(details.open).toBe(false));
});

it("dismisses on Escape from outside the picker without clearing the composer", async () => {
  const { details } = await openPicker();
  const composer = screen.getByLabelText("Composer");
  composer.focus();
  fireEvent.change(composer, { target: { value: "Keep my draft" } });
  fireEvent.keyDown(composer, { key: "Escape" });
  expect(details.open).toBe(false);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep my draft");
});

it("keeps the picker open for inside clicks and returns focus to the trigger on Escape", async () => {
  const { trigger, details } = await openPicker();
  await userEvent.click(screen.getByLabelText("Model"));
  expect(details.open).toBe(true);
  fireEvent.keyDown(screen.getByLabelText("Model"), { key: "Escape" });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("dismisses for outside clicks without a pointer event (native accessibility)", async () => {
  const { details } = await openPicker();
  fireEvent.click(screen.getByLabelText("Composer"));
  expect(details.open).toBe(false);
});
