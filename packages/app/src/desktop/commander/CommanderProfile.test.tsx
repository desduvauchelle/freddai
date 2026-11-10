import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CommanderProfileData } from "./api";

const api = vi.hoisted(() => ({ profile: vi.fn(), profileSave: vi.fn(), revisionRestore: vi.fn(), memory: vi.fn(), memorySave: vi.fn() }));
vi.mock("./api", () => ({ commanderApi: api }));
import { CommanderProfile, PRESETS } from "./CommanderProfile";

const prof = (over: Partial<CommanderProfileData> = {}): CommanderProfileData => ({
  name: "Commander-in-Chief", soul: "Be nice.", user: "Likes tea.", prompt_preview: "# Identity\nCommander-in-Chief",
  revisions: [{ file: "soul", at: "2026-11-07T10:00:00Z", by: "commander", reason: "Tone tweak" }], ...over,
});
beforeEach(() => { api.profile.mockResolvedValue(prof()); api.memory.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("loads and displays the profile", async () => {
  render(<CommanderProfile />);
  expect(await screen.findByDisplayValue("Commander-in-Chief")).toBeTruthy();
  expect(screen.getByDisplayValue("Be nice.")).toBeTruthy();
  expect(screen.getByDisplayValue("Likes tea.")).toBeTruthy();
  expect(screen.getByText("Tone tweak")).toBeTruthy();
  expect(screen.getByText("Commander")).toBeTruthy();
  expect(screen.getByText(/keeps this up to date quietly/)).toBeTruthy();
});

it("rename saves and refreshes commander state", async () => {
  const onSaved = vi.fn();
  api.profileSave.mockResolvedValue(prof({ name: "Fred" }));
  render(<CommanderProfile onSaved={onSaved} />);
  fireEvent.change(await screen.findByLabelText("Assistant name"), { target: { value: "Fred" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(api.profileSave).toHaveBeenCalledWith({ name: "Fred" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it("a preset fills the soul editor and save sends the reason", async () => {
  api.profileSave.mockResolvedValue(prof({ soul: PRESETS[2]!.soul }));
  render(<CommanderProfile />);
  await screen.findByDisplayValue("Be nice.");
  fireEvent.click(screen.getByRole("button", { name: /Direct & no-nonsense/ }));
  expect((screen.getByLabelText("Attitude (SOUL.md)") as HTMLTextAreaElement).value).toBe(PRESETS[2]!.soul);
  expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Reason for change (optional)"), { target: { value: "too chatty" } });
  fireEvent.click(screen.getByRole("button", { name: "Save attitude" }));
  await waitFor(() => expect(api.profileSave).toHaveBeenCalledWith({ soul: PRESETS[2]!.soul, reason: "too chatty" }));
});

it("restore asks for confirmation then calls restore", async () => {
  api.revisionRestore.mockResolvedValue(prof({ soul: "Old." }));
  render(<CommanderProfile />);
  fireEvent.click(await screen.findByRole("button", { name: /Restore Attitude from/ }));
  expect(api.revisionRestore).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm restore" })).getByRole("button", { name: "Confirm restore" }));
  await waitFor(() => expect(api.revisionRestore).toHaveBeenCalledWith("soul", "2026-11-07T10:00:00Z"));
  await waitFor(() => expect(screen.getByDisplayValue("Old.")).toBeTruthy());
});

it("developer section is collapsed by default", async () => {
  const { container } = render(<CommanderProfile />);
  await screen.findByDisplayValue("Be nice.");
  const d = container.querySelector("details")!;
  expect(d.open).toBe(false);
  expect(screen.getByText(/What Commander sees/)).toBeTruthy();
});

it("renders errors loudly", async () => {
  api.profileSave.mockRejectedValue(new Error("disk full"));
  render(<CommanderProfile />);
  fireEvent.change(await screen.findByLabelText("Assistant name"), { target: { value: "X" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect((await screen.findByRole("alert")).textContent).toContain("disk full");
});

it("shows a load error", async () => {
  api.profile.mockRejectedValue(new Error("no host"));
  render(<CommanderProfile />);
  expect((await screen.findByRole("alert")).textContent).toContain("no host");
});
