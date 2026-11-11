// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTICS, ANTIC_MAX_WAIT_MS, playAntic, resetAntics, useAntic } from "./mascot-antics";

const stubMotion = (reduce: boolean) => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })));

/** Step the clock until an antic shows (they start between 25 and 70 s). */
const untilAntic = (current: () => unknown) => { for (let t = 0; t <= ANTIC_MAX_WAIT_MS && !current(); t += 500) act(() => { vi.advanceTimersByTime(500); }); };

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); stubMotion(false); resetAntics(); });
afterEach(() => { cleanup(); resetAntics(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("mascot antics", () => {
  it("plays nothing before the wait elapses, starts one after, and clears after its duration", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // shortest wait (25 s), first antic
    const { result } = renderHook(() => useAntic(true));
    act(() => { vi.advanceTimersByTime(24_999); });
    expect(result.current).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current?.name).toBe("Hula");
    act(() => { vi.advanceTimersByTime(ANTICS[0].ms - 1); });
    expect(result.current).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBeNull();
  });

  it("never repeats the same antic twice in a row", () => {
    const { result } = renderHook(() => useAntic(true));
    let previous = -1;
    for (let i = 0; i < 12; i++) {
      untilAntic(() => result.current);
      const mood = result.current!.mood;
      expect(mood).not.toBe(previous);
      previous = mood;
      act(() => { vi.advanceTimersByTime(14_000); });
      expect(result.current).toBeNull();
    }
  });

  it("never schedules when disabled", () => {
    const { result } = renderHook(() => useAntic(false));
    act(() => { vi.advanceTimersByTime(ANTIC_MAX_WAIT_MS * 3); });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is blocked while paused and under reduced motion", () => {
    localStorage.setItem("freddai.mascotPaused", "true");
    const paused = renderHook(() => useAntic(true));
    act(() => { vi.advanceTimersByTime(ANTIC_MAX_WAIT_MS * 2); });
    expect(paused.result.current).toBeNull();
    paused.unmount();
    localStorage.clear();
    stubMotion(true);
    const reduced = renderHook(() => useAntic(true));
    act(() => { vi.advanceTimersByTime(ANTIC_MAX_WAIT_MS * 2); });
    expect(reduced.result.current).toBeNull();
  });

  it("playAntic starts immediately and restarts the idle wait afterward", () => {
    const { result } = renderHook(() => useAntic(true));
    act(() => { playAntic(); });
    expect(result.current).not.toBeNull();
    act(() => { playAntic(13); });
    expect(result.current?.name).toBe("Juggle");
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current).toBeNull();
    untilAntic(() => result.current);
    expect(result.current).not.toBeNull();
  });

  it("clears timers when the last subscriber unmounts", () => {
    const { unmount } = renderHook(() => useAntic(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
