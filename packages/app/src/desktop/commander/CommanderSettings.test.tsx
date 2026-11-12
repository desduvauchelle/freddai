import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../types";

const api = vi.hoisted(() => ({ getCommanderSettings: vi.fn(), saveCommanderSettings: vi.fn() }));
vi.mock("./api", async orig => ({ ...(await orig<typeof import("./api")>()), commanderApi: api }));
vi.mock("./SpeechSettings", () => ({ SpeechSettings: () => null }));
import { DEFAULT_COMMANDER_SETTINGS } from "./api";
import { CommanderSettings } from "./CommanderSettings";

const project = (id: string, name: string, kind?: "commander"): Project => ({ id, name, path: `/p/${id}`, color: "#888", policy: "inherit", account: null, last: null, ...(kind ? { kind } : {}) });
const projects = [project("chief", "Ada", "commander"), project("alpha", "Alpha"), project("beta", "Beta")];
beforeEach(() => { api.getCommanderSettings.mockResolvedValue(DEFAULT_COMMANDER_SETTINGS); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("loads defaults and reveals budget fields only in Budgeted mode, excluding the commander project", async () => {
  render(<CommanderSettings projects={projects} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Propose/ }).getAttribute("aria-pressed")).toBe("true"));
  expect(screen.queryByLabelText("Max agents at once")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Budgeted/ }));
  expect((screen.getByLabelText("Max agents at once") as HTMLInputElement).value).toBe("2");
  expect((screen.getByLabelText("Daily start cap") as HTMLInputElement).value).toBe("5");
  expect(screen.getByLabelText("Alpha")).toBeTruthy();
  expect(screen.queryByLabelText("Ada")).toBeNull();
  expect((screen.getByLabelText("Heartbeat interval") as HTMLSelectElement).value).toBe("60");
});

it("saves the edited settings", async () => {
  api.saveCommanderSettings.mockImplementation(async s => s);
  render(<CommanderSettings projects={projects} />);
  fireEvent.click(await screen.findByRole("button", { name: /Budgeted/ }));
  fireEvent.click(screen.getByLabelText("Beta"));
  fireEvent.click(screen.getByLabelText("Enable heartbeat"));
  fireEvent.change(screen.getByLabelText("Heartbeat interval"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Save autonomy settings" }));
  await screen.findByText("Saved");
  expect(api.saveCommanderSettings).toHaveBeenCalledWith({
    autonomy: { mode: "budgeted", maxConcurrent: 2, dailyStartCap: 5, allowedProjectIds: ["beta"] },
    heartbeat: { enabled: true, intervalMinutes: 30, activeStart: "08:00", activeEnd: "20:00" },
  });
});

it("shows the backend's field-naming save error inline", async () => {
  api.saveCommanderSettings.mockRejectedValue(new Error("autonomy.maxConcurrent must be between 1 and 8"));
  render(<CommanderSettings projects={projects} />);
  fireEvent.click(await screen.findByRole("button", { name: /Budgeted/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save autonomy settings" }));
  expect((await screen.findByRole("alert")).textContent).toContain("autonomy.maxConcurrent must be between 1 and 8");
});
