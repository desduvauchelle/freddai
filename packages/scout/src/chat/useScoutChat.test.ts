import { createElement, type ReactNode } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Session } from "@freddai/shared/agent/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@freddai/shared/agent/client", () => ({
  launchThread: vi.fn(),
  queueMessage: vi.fn(async () => undefined),
  respond: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}));

import { queueMessage, respond, stop } from "@freddai/shared/agent/client";
import { useScoutChat } from "./useScoutChat";
import { FreddaiStatusNote, FreddaiErrorContext, OpenThreadsContext, useOpenThreadRegistry } from "../freddaiLink";

const session = (patch: Partial<Session> = {}): Session => ({
  id: "s1", project: "p1", account: "a1", title: "t", status: "idle", updated: 1, provider_id: null,
  messages: [], pending: null, error: null, ...patch,
});
const dbWith = (...sessions: Session[]): Database => ({
  accounts: [], projects: [], sessions, preferences: { prefer_last: false, fallback: null, last: null },
});

beforeEach(() => { vi.clearAllMocks(); });

describe("useScoutChat", () => {
  it("launches on the first send, then queues follow-ups on the new session", async () => {
    const launch = vi.fn(async () => "s1");
    const onSessionCreated = vi.fn();
    const format = (text: string, first: boolean) => (first ? `CTX\n\n${text}` : text);
    const { result, rerender } = renderHook(({ db, session: id }) => useScoutChat({ db, session: id, onSessionCreated, launch, format }),
      { initialProps: { db: dbWith() as Database | null, session: null as string | null } });

    let ok = false;
    await act(async () => { ok = await result.current.send("hello"); });
    expect(ok).toBe(true);
    expect(launch).toHaveBeenCalledWith("CTX\n\nhello");
    expect(onSessionCreated).toHaveBeenCalledWith("s1");
    expect(queueMessage).not.toHaveBeenCalled();
    // optimistic message stays until the snapshot echoes it
    expect(result.current.pending.map(p => p.text)).toEqual(["hello"]);

    rerender({ db: dbWith(session({ messages: [{ id: "m1", role: "user", text: "CTX\n\nhello" }] })), session: "s1" });
    expect(result.current.pending).toEqual([]);

    await act(async () => { await result.current.send("again"); });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(queueMessage).toHaveBeenCalledWith("s1", "again");
  });

  it("answers approvals with the request id DesktopApp builds", async () => {
    const pending = { request_id: "req-7", id: 3 };
    const { result } = renderHook(() => useScoutChat({ db: dbWith(session({ status: "waiting", pending })), session: "s1", onSessionCreated: vi.fn(), launch: vi.fn() }));
    expect(result.current.approval).toEqual(pending);
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.approve(true, { q: "yes" }); });
    expect(respond).toHaveBeenCalledWith("s1", JSON.stringify(pending.request_id ?? pending.id), true, { q: "yes" });

    const numeric = { id: 42 };
    const second = renderHook(() => useScoutChat({ db: dbWith(session({ pending: numeric })), session: "s1", onSessionCreated: vi.fn(), launch: vi.fn() }));
    await act(async () => { await second.result.current.approve(false); });
    expect(respond).toHaveBeenLastCalledWith("s1", "42", false, {});
  });

  it("surfaces errors instead of swallowing them", async () => {
    const launch = vi.fn(async () => { throw new Error("no account configured"); });
    const { result } = renderHook(() => useScoutChat({ db: dbWith(), session: null, onSessionCreated: vi.fn(), launch }));
    let ok = true;
    await act(async () => { ok = await result.current.send("hi"); });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("no account configured");
    expect(result.current.pending).toEqual([]);

    vi.mocked(respond).mockRejectedValueOnce(new Error("request expired"));
    const approval = renderHook(() => useScoutChat({ db: dbWith(session({ pending: { id: 1 } })), session: "s1", onSessionCreated: vi.fn(), launch: vi.fn() }));
    await act(async () => { await expect(approval.result.current.approve(true)).rejects.toThrow("request expired"); });
    expect(approval.result.current.error).toBe("request expired");

    vi.mocked(stop).mockRejectedValueOnce("stop failed");
    await act(async () => { await approval.result.current.stop(); });
    expect(approval.result.current.error).toBe("stop failed");
  });
});

describe("open thread scope", () => {
  it("registers its session with the shell and never shows a summary-only transcript", () => {
    const register = vi.fn(() => vi.fn());
    const wrapper = ({ children }: { children: ReactNode }) => createElement(OpenThreadsContext.Provider, { value: register }, children);
    const summary = session({ transcriptLoaded: false, messages: [{ id: "m", role: "assistant", text: "last" }] as Session["messages"] });
    const { result, rerender } = renderHook(({ db }) => useScoutChat({ db, session: "s1", onSessionCreated: vi.fn(), launch: vi.fn() }),
      { wrapper, initialProps: { db: dbWith(summary) } });
    expect(register).toHaveBeenCalledWith("s1");
    expect(result.current.messages).toEqual([]);
    rerender({ db: dbWith({ ...summary, transcriptLoaded: true }) });
    expect(result.current.messages).toHaveLength(1);
  });

  it("the registry de-duplicates and releases threads", () => {
    const { result } = renderHook(() => useOpenThreadRegistry());
    let a!: () => void, b!: () => void;
    act(() => { a = result.current[1]("t2"); b = result.current[1]("t2"); result.current[1]("t1"); });
    expect(result.current[0]).toEqual(["t1", "t2"]);
    act(() => a());
    expect(result.current[0]).toEqual(["t1", "t2"]);
    act(() => b());
    expect(result.current[0]).toEqual(["t1"]);
  });

  it("shows nothing while loading, the error text on failure", () => {
    const { container, rerender } = render(createElement(FreddaiStatusNote, { db: null }));
    expect(container.textContent).toBe("");
    rerender(createElement(FreddaiErrorContext.Provider, { value: "Host reply too large" }, createElement(FreddaiStatusNote, { db: null })));
    expect(container.textContent).toContain("Host reply too large");
  });
});
