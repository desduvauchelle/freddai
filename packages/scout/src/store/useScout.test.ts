import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutState } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api", () => ({
  scoutState: vi.fn(),
  scoutItemSave: vi.fn(),
  scoutSampleData: vi.fn(),
}));

import * as api from "../api";
import { SCOUT_POLL_MS, useScout } from "./useScout";

const mocked = api as unknown as {
  scoutState: ReturnType<typeof vi.fn>;
  scoutItemSave: ReturnType<typeof vi.fn>;
  scoutSampleData: ReturnType<typeof vi.fn>;
};

function makeState(revision: number, extra: Partial<ScoutState> = {}): ScoutState {
  return {
    revision,
    workspaces: [],
    projects: [],
    items: [],
    rules: [],
    sources: [],
    settings: { onboarding_done: true, onboarding_step: 1, sample_data: false },
    ...extra,
  } as ScoutState;
}

describe("useScout", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("loads scout_state on mount", async () => {
    mocked.scoutState.mockResolvedValue(makeState(3));
    const { result } = renderHook(() => useScout());
    await waitFor(() => expect(result.current.state?.revision).toBe(3));
    expect(result.current.error).toBeNull();
    expect(mocked.scoutState).toHaveBeenCalledTimes(1);
  });

  it("replaces state with the result of an action", async () => {
    mocked.scoutState.mockResolvedValue(makeState(1));
    mocked.scoutSampleData.mockResolvedValue(makeState(2, { settings: { onboarding_done: true, onboarding_step: 1, sample_data: true } }));
    const { result } = renderHook(() => useScout());
    await waitFor(() => expect(result.current.state?.revision).toBe(1));
    await act(() => result.current.actions.sampleData(true));
    expect(mocked.scoutSampleData).toHaveBeenCalledWith(true);
    expect(result.current.state?.revision).toBe(2);
    expect(result.current.state?.settings.sample_data).toBe(true);
  });

  it("stores the error message and rethrows it", async () => {
    mocked.scoutState.mockResolvedValue(makeState(1));
    mocked.scoutItemSave.mockRejectedValue(new Error("item not found: x"));
    const { result } = renderHook(() => useScout());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    let thrown: unknown;
    await act(async () => {
      try { await result.current.actions.itemSave({ id: "x" } as never); } catch (e) { thrown = e; }
    });
    expect((thrown as Error).message).toBe("item not found: x");
    expect(result.current.error).toBe("item not found: x");
    expect(result.current.state?.revision).toBe(1);
  });

  it("captures a load failure as an error string", async () => {
    mocked.scoutState.mockRejectedValue("state.json is corrupt");
    const { result } = renderHook(() => useScout());
    await waitFor(() => expect(result.current.error).toBe("state.json is corrupt"));
    expect(result.current.state).toBeNull();
  });

  it("ignores poll results with a lower revision", async () => {
    vi.useFakeTimers();
    mocked.scoutState.mockResolvedValueOnce(makeState(1));
    mocked.scoutItemSave.mockResolvedValue(makeState(5));
    const { result } = renderHook(() => useScout());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state?.revision).toBe(1);
    await act(() => result.current.actions.itemSave({ id: "a" } as never));
    expect(result.current.state?.revision).toBe(5);
    mocked.scoutState.mockResolvedValue(makeState(4));
    await act(async () => { await vi.advanceTimersByTimeAsync(SCOUT_POLL_MS); });
    expect(mocked.scoutState).toHaveBeenCalledTimes(2);
    expect(result.current.state?.revision).toBe(5);
    mocked.scoutState.mockResolvedValue(makeState(6));
    await act(async () => { await vi.advanceTimersByTimeAsync(SCOUT_POLL_MS); });
    expect(result.current.state?.revision).toBe(6);
  });
});
