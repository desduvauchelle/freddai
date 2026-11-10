import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
import { VoiceSettings } from "./VoiceSettings";

const model = (over: object) => ({ id: "m", name: "Base", description: "Fast", languageLabel: "Multilingual", sizeBytes: 574_000_000, recommended: false, installed: false, download: null, ...over });
const status = (over: object = {}) => ({ enabled: false, activeModel: null, shortcut: "AltRight", language: "auto", removeFillerWords: true, ready: false, recording: false, models: [model({})], ...over });
beforeEach(() => { invoke.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(cleanup);

it("explains the browser preview", () => {
  render(<VoiceSettings native={false} />);
  expect(screen.getByText("Voice dictation needs the Mac app.")).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});
it("disables the toggle with a hint until a model is installed", async () => {
  invoke.mockResolvedValue(status());
  render(<VoiceSettings native />);
  await screen.findByText("Base");
  expect((screen.getByRole("switch", { name: "Enable voice dictation" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Download a model first")).toBeTruthy();
  expect(screen.getByText("574 MB", { exact: false })).toBeTruthy();
});
it("shows download progress with a cancel button", async () => {
  invoke.mockResolvedValue(status({ models: [model({ download: { downloadedBytes: 250, totalBytes: 1000, error: null } })] }));
  render(<VoiceSettings native />);
  expect(await screen.findByText("25% downloaded")).toBeTruthy();
  invoke.mockResolvedValue(status());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(invoke).toHaveBeenCalledWith("voice_cancel_download", { id: "m" });
});
it("offers Use this model, Active and confirmed Remove", async () => {
  invoke.mockResolvedValue(status({ activeModel: "a", models: [model({ id: "a", name: "Active one", installed: true }), model({ id: "b", name: "Other", installed: true, recommended: true })] }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<VoiceSettings native />);
  await screen.findByText("Other");
  expect(screen.getByText("Active")).toBeTruthy();
  expect(screen.getByText("Recommended")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Use this model" }));
  expect(invoke).toHaveBeenCalledWith("voice_update_settings", { settings: { activeModel: "b" } });
  await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
  expect(invoke).toHaveBeenCalledWith("voice_delete_model", { id: "b" });
});
it("shows invoke errors and download errors with Retry", async () => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "voice_download_model") throw "network down";
    return status({ models: [model({ download: { downloadedBytes: 0, totalBytes: 10, error: "checksum mismatch" } })] });
  });
  render(<VoiceSettings native />);
  expect(await screen.findByText("Download failed: checksum mismatch")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
});

it("defaults filler removal on and saves the opt-out", async () => {
  invoke.mockImplementation(async (command: string) => status({ removeFillerWords: command !== "voice_update_settings" }));
  render(<VoiceSettings native />);
  await screen.findByText("Base");
  expect(screen.getByRole("switch", { name: "Remove filler words" }).getAttribute("aria-checked")).toBe("true");
  await userEvent.click(screen.getByRole("switch", { name: "Remove filler words" }));
  expect(invoke).toHaveBeenCalledWith("voice_update_settings", { settings: { removeFillerWords: false } });
  await waitFor(() => expect(screen.getByRole("switch", { name: "Remove filler words" }).getAttribute("aria-checked")).toBe("false"));
});
