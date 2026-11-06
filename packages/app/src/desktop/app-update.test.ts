import { describe, expect, it } from "vitest";
import { downloadPercent, manualCheckNotice, UP_TO_DATE_NOTICE, updateBanner } from "./app-update";

describe("app update banner", () => {
  it("shows nothing while idle or checking", () => {
    expect(updateBanner({ state: "idle" })).toBeNull();
    expect(updateBanner({ state: "checking" })).toBeNull();
  });
  it("offers Update & restart when self-update works", () => {
    const b = updateBanner({ state: "available", version: "0.2.0", manual: false })!;
    expect(b.text).toBe("Freddai 0.2.0 is available.");
    expect(b.action).toEqual({ kind: "install", label: "Update & restart" });
  });
  it("opens the release page on non-AppImage Linux", () => {
    expect(updateBanner({ state: "available", version: "0.2.0", manual: true })!.action!.kind).toBe("open_release");
  });
  it("shows download progress and is busy", () => {
    const b = updateBanner({ state: "downloading", version: "0.2.0", downloaded: 50, total: 200 })!;
    expect(b.text).toContain("25%");
    expect(b.busy).toBe(true);
    expect(updateBanner({ state: "downloading", version: "0.2.0", downloaded: 5 })!.text).toBe("Downloading Freddai 0.2.0…");
  });
  it("offers restart once installed", () => {
    expect(updateBanner({ state: "ready_to_restart", version: "0.2.0" })!.action!.kind).toBe("restart");
  });
  it("surfaces errors loudly with a retry", () => {
    const b = updateBanner({ state: "error", message: "Couldn't check for updates: offline" })!;
    expect(b.error).toBe(true);
    expect(b.text).toBe("Couldn't check for updates: offline");
    expect(b.action!.kind).toBe("retry");
  });
  it("clamps percent and handles unknown totals", () => {
    expect(downloadPercent(500, 200)).toBe(100);
    expect(downloadPercent(1, null)).toBeNull();
    expect(downloadPercent(1, 0)).toBeNull();
  });
  it("local build shows a quiet notice, never a banner", () => {
    const s = { state: "local_build", published: "0.3.0" } as const;
    expect(updateBanner(s)).toBeNull();
    expect(manualCheckNotice(s)).toBe("Local build \u2014 published version is 0.3.0");
  });
  it("reports up to date only for manual checks that end idle", () => {
    expect(manualCheckNotice({ state: "idle" })).toBe(UP_TO_DATE_NOTICE);
    expect(manualCheckNotice({ state: "available", version: "1", manual: false })).toBeNull();
    expect(manualCheckNotice({ state: "error", message: "x" })).toBeNull();
  });
});

describe("draft persistence across restart", () => {
  it("saves drafts and restores them once for open threads", async () => {
    localStorage.clear();
    const store = { get size() { return localStorage.length; } };
    const { vi } = await import("vitest");
    const first = await import("./drafts");
    first.setDraft("t1", "hello"); first.setDraft("t2", "bye");
    first.saveDraftsForRestart("new text");
    expect(store.size).toBe(2);
    vi.resetModules();
    const second = await import("./drafts");
    expect(store.size).toBe(1);
    expect(second.getDraft("t1")).toBe("hello");
    expect(second.restoreDrafts(["t1"])).toBe("new text");
    expect(second.getDraft("t1")).toBe("hello");
    expect(second.getDraft("t2")).toBe("bye");
    second.restoreDrafts(["t2"]);
    expect(second.getDraft("t2")).toBe("bye");
    expect(second.restoreDrafts(["t1"])).toBeNull();
  });
});

it("persists contextual drafts on typing and deletion without an updater restart", async () => {
  localStorage.clear();
  const { vi } = await import("vitest");
  vi.resetModules();
  const first = await import("./drafts");
  first.setDraft("reply", "Unsent reply");
  first.setDraft(first.newThreadDraftKey("alpha"), "Alpha draft");
  first.setDraft(first.newThreadDraftKey("beta"), "Beta draft");
  first.setDraft(first.newThreadDraftKey(""), "Global draft");
  vi.resetModules();
  const second = await import("./drafts");
  expect(second.getDraft("reply")).toBe("Unsent reply");
  expect(second.getDraft(second.newThreadDraftKey("alpha"))).toBe("Alpha draft");
  expect(second.getDraft(second.newThreadDraftKey("beta"))).toBe("Beta draft");
  expect(second.getDraft(second.newThreadDraftKey(""))).toBe("Global draft");
  second.setDraft(second.newThreadDraftKey("alpha"), "");
  vi.resetModules();
  const third = await import("./drafts");
  expect(third.getDraft(third.newThreadDraftKey("alpha"))).toBe("");
  expect(third.getDraft("reply")).toBe("Unsent reply");
});

it("preserves another window's saved context and receives its changes", async () => {
  localStorage.clear();
  const { vi } = await import("vitest");
  vi.resetModules();
  const store = await import("./drafts");
  store.setDraft("one", "First window");
  localStorage.setItem("freddai.composer-drafts", JSON.stringify({ one: "First window", two: "Second window" }));
  store.setDraft("one", "Edited first window");
  expect(JSON.parse(localStorage.getItem("freddai.composer-drafts")!)).toEqual({ one: "Edited first window", two: "Second window" });
  window.dispatchEvent(new StorageEvent("storage", { key: "freddai.composer-drafts" }));
  expect(store.getDraft("two")).toBe("Second window");
});
