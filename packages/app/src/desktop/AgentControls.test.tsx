import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentControls } from "./AgentControls";

afterEach(cleanup);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

async function openPicker(onChange = vi.fn()) {
  render(<><AgentControls native={false} provider="claude" value={{ model: "", effort: "default" }} onChange={onChange} /><textarea aria-label="Composer" /></>);
  const trigger = screen.getByRole("combobox", { name: "Agent difficulty" });
  await userEvent.click(trigger);
  return { trigger, onChange };
}
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

it("opens a single list of difficulties and picks in one click", async () => {
  const { onChange } = await openPicker();
  expect((await screen.findAllByRole("option")).map(o => o.textContent)).toEqual(["Smart", "Normal", "Fast", "Custom"]);
  await userEvent.click(screen.getByRole("option", { name: "Smart" }));
  expect(onChange).toHaveBeenCalledWith({ model: "freddai-level:smart", effort: "default" });
});

it("closes the list with Escape and leaves the composer draft alone", async () => {
  await openPicker();
  await screen.findAllByRole("option");
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(screen.getByLabelText("Composer")).toBeTruthy();
});

it("custom level shows a separate model chip that opens the custom panel", async () => {
  render(<AgentControls native={false} provider="claude" value={{ model: "freddai-custom:", effort: "default" }} onChange={vi.fn()} />);
  const chip = screen.getByLabelText("Custom model");
  const details = chip.closest("details")!;
  await userEvent.click(chip);
  await waitFor(() => expect(details.open).toBe(true));
  expect(screen.getByLabelText("Custom model ID")).toBeTruthy();
  fireEvent.click(document.body);
  expect(details.open).toBe(false);
});
