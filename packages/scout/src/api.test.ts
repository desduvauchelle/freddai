import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { scoutItemMove, scoutSampleData, scoutState, type ScoutState } from "./api";

const empty: ScoutState = {
  revision: 3,
  workspaces: [],
  projects: [],
  items: [],
  rules: [],
  sources: [],
  settings: { onboarding_done: false, onboarding_step: 0, sample_data: false },
};

describe("scout api", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue(empty));

  it("scoutState invokes scout_state with no args", async () => {
    await expect(scoutState()).resolves.toEqual(empty);
    expect(invoke).toHaveBeenCalledWith("scout_state");
  });

  it("scoutItemMove passes id, lane and index", async () => {
    await scoutItemMove("i1", "done", 2);
    expect(invoke).toHaveBeenCalledWith("scout_item_move", { id: "i1", lane: "done", index: 2 });
  });

  it("scoutSampleData passes load and propagates errors", async () => {
    invoke.mockRejectedValueOnce("boom");
    await expect(scoutSampleData(true)).rejects.toBe("boom");
    expect(invoke).toHaveBeenCalledWith("scout_sample_data", { load: true });
  });
});
