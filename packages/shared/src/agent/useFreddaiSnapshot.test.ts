import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { useFreddaiSnapshot } from "./useFreddaiSnapshot";

afterEach(() => invoke.mockReset());

const session = (id: string, text = "hi") => ({ id, title: id, messages: [{ id: `${id}-m`, role: "assistant", text }] });
const full = (revision: number, sessions: ReturnType<typeof session>[], hostId = "h1") =>
  ({ revision, hostId, full: true, sessionIds: sessions.map(s => s.id), sessions, accounts: [], projects: [], queues: {}, preferences: {}, schedules: [] });

describe("useFreddaiSnapshot", () => {
  it("surfaces an error string when the snapshot fails", async () => {
    invoke.mockRejectedValue("host offline");
    const { result } = renderHook(() => useFreddaiSnapshot({ intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.error).toBe("host offline"));
    expect(result.current.db).toBeNull();
    expect(invoke).toHaveBeenCalledWith("snapshot_since", { revision: 0, hostId: null, openThreads: [] });
    expect(invoke).not.toHaveBeenCalledWith("snapshot", expect.anything());
  });

  it("starts from revision 0, then asks only for changes since the returned cursor", async () => {
    invoke.mockResolvedValueOnce(full(5, [session("a")])).mockResolvedValueOnce({ revision: 5, hostId: "h1", unchanged: true });
    const { result } = renderHook(() => useFreddaiSnapshot({ intervalMs: 60_000, openThreads: ["a"] }));
    await waitFor(() => expect(result.current.db?.sessions.map(s => s.id)).toEqual(["a"]));
    const first = result.current.db;
    await act(async () => { await result.current.refresh(); });
    expect(invoke).toHaveBeenNthCalledWith(1, "snapshot_since", { revision: 0, hostId: null, openThreads: ["a"] });
    expect(invoke).toHaveBeenNthCalledWith(2, "snapshot_since", { revision: 5, hostId: "h1", openThreads: ["a"] });
    expect(result.current.db).toBe(first);
    expect(result.current.error).toBeNull();
  });

  it("merges a partial delta, keeping unchanged sessions by identity", async () => {
    invoke.mockResolvedValueOnce(full(1, [session("a"), session("b")]))
      .mockResolvedValueOnce({ revision: 2, hostId: "h1", full: false, sessionIds: ["a", "b"], sessions: [session("b", "new")] });
    const { result } = renderHook(() => useFreddaiSnapshot({ intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.db).not.toBeNull());
    const a = result.current.db!.sessions[0];
    await act(async () => { await result.current.refresh(); });
    expect(result.current.db!.sessions[0]).toBe(a);
    expect(result.current.db!.sessions[1].messages[0].text).toBe("new");
  });

  it("resets the cursor when the open threads change", async () => {
    invoke.mockResolvedValueOnce(full(3, [session("a")])).mockResolvedValueOnce(full(3, [session("a")]));
    const { result, rerender } = renderHook(({ open }) => useFreddaiSnapshot({ intervalMs: 60_000, openThreads: open }), { initialProps: { open: [] as string[] } });
    await waitFor(() => expect(result.current.db).not.toBeNull());
    rerender({ open: ["a"] });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("snapshot_since", { revision: 0, hostId: null, openThreads: ["a"] });
  });

  it("refetches in full when the host changes or a delta cannot be applied", async () => {
    invoke.mockResolvedValueOnce(full(3, [session("a")]))
      .mockResolvedValueOnce({ revision: 4, hostId: "h1", full: false, sessionIds: ["a", "zz"], sessions: [] })
      .mockResolvedValueOnce(full(1, [session("x")], "h2"));
    const { result } = renderHook(() => useFreddaiSnapshot({ intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.db).not.toBeNull());
    await act(async () => { await result.current.refresh(); });
    expect(invoke).toHaveBeenLastCalledWith("snapshot_since", { revision: 0, hostId: null, openThreads: [] });
    expect(result.current.db!.sessions.map(s => s.id)).toEqual(["x"]);
    expect(result.current.error).toBeNull();
  });

  it("skips a poll tick while a previous call is still pending and never overlaps calls", async () => {
    vi.useFakeTimers();
    try {
      const resolvers: ((v: unknown) => void)[] = [];
      invoke.mockImplementation(() => new Promise(r => { resolvers.push(r); }));
      const { result } = renderHook(() => useFreddaiSnapshot({ intervalMs: 1000 }));
      await act(async () => {});
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
      expect(invoke).toHaveBeenCalledTimes(1);
      // An explicit refresh queues behind the in-flight call instead of racing it.
      await act(async () => { void result.current.refresh(); });
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(async () => { resolvers[0](full(1, [session("a")])); });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenLastCalledWith("snapshot_since", { revision: 1, hostId: "h1", openThreads: [] });
    } finally { vi.useRealTimers(); }
  });

  it("drops a reply whose scope changed while it was in flight", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    invoke.mockImplementation(() => new Promise(r => { resolvers.push(r); }));
    const { result, rerender } = renderHook(({ open }) => useFreddaiSnapshot({ intervalMs: 60_000, openThreads: open }), { initialProps: { open: [] as string[] } });
    await act(async () => {});
    rerender({ open: ["b"] });
    await act(async () => { resolvers[0](full(1, [session("stale")])); });
    expect(result.current.db).toBeNull();
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(1));
    expect(invoke).toHaveBeenNthCalledWith(2, "snapshot_since", { revision: 0, hostId: null, openThreads: ["b"] });
    await act(async () => { for (const r of resolvers.slice(1)) r(full(2, [session("b")])); });
    await waitFor(() => expect(result.current.db?.sessions.map(s => s.id)).toEqual(["b"]));
  });
});
