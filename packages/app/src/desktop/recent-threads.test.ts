import { expect, it } from "vitest";
import { RECENT_FINISHED_DEFAULT, sanitizeRecentCount, splitOlderThreads } from "./types";

const list = ["a", "b", "c", "d"];

it("defaults to keeping five recent finished threads", () => {
  expect(RECENT_FINISHED_DEFAULT).toBe(5);
});
it("0 keeps nothing visible", () => {
  expect(splitOlderThreads(list, 0)).toEqual({ recent: [], rest: list });
});
it("N smaller than the list splits it", () => {
  expect(splitOlderThreads(list, 2)).toEqual({ recent: ["a", "b"], rest: ["c", "d"] });
});
it("N larger than the list leaves nothing older", () => {
  expect(splitOlderThreads(list, 10)).toEqual({ recent: list, rest: [] });
});
it("preserves order and does not mutate input", () => {
  const input = ["z", "y", "x"];
  const { recent, rest } = splitOlderThreads(input, 1);
  expect([...recent, ...rest]).toEqual(["z", "y", "x"]);
  expect(input).toEqual(["z", "y", "x"]);
});
it("sanitises bad input", () => {
  expect(sanitizeRecentCount(-3)).toBe(0);
  expect(sanitizeRecentCount(2.9)).toBe(2);
  expect(sanitizeRecentCount(999)).toBe(50);
  expect(sanitizeRecentCount("7")).toBe(7);
  expect(sanitizeRecentCount("abc")).toBe(5);
  expect(sanitizeRecentCount(null)).toBe(5);
  expect(sanitizeRecentCount(NaN)).toBe(5);
});

import { bucketThreads } from "./types";

const th = (id: string, project: string, updated: number, status = "done") => ({ id, project, updated, status, title: id }) as never as { id: string; project: string; updated: number; status: string };
const ids = (l: { id: string }[]) => l.map(t => t.id);
const base = { read: {} as Record<string, number>, selected: "", recentCount: 2, scope: "flat" as const, hideRead: true, filter: "all" };
const allRead = (l: { id: string; updated: number }[]) => Object.fromEntries(l.map(t => [t.id, t.updated]));

it("flat mode: recent is the N newest non-live threads across projects", () => {
  const l = [th("a", "p1", 90), th("b", "p2", 80), th("c", "p1", 70), th("d", "p2", 60)];
  const r = bucketThreads(l, { ...base, read: allRead(l) });
  expect(ids(r.active)).toEqual([]);
  expect(ids(r.recent)).toEqual(["a", "b"]);
  expect(ids(r.older)).toEqual(["c", "d"]);
});
it("grouped mode: N per project", () => {
  const l = [th("a", "p1", 90), th("b", "p1", 80), th("c", "p1", 70), th("d", "p2", 60)];
  const r = bucketThreads(l, { ...base, read: allRead(l), scope: "grouped", recentCount: 1 });
  expect(ids(r.recent)).toEqual(["a", "d"]);
  expect(ids(r.older)).toEqual(["b", "c"]);
});
it("a selected recent thread stays in recent", () => {
  const l = [th("a", "p", 90), th("b", "p", 80), th("c", "p", 70)];
  const r = bucketThreads(l, { ...base, read: allRead(l), selected: "b" });
  expect(ids(r.active)).toEqual([]);
  expect(ids(r.recent)).toEqual(["a", "b"]);
});
it("a selected older thread is appended to recent", () => {
  const l = [th("a", "p", 90), th("b", "p", 80), th("c", "p", 70), th("d", "p", 60)];
  const r = bucketThreads(l, { ...base, read: allRead(l), selected: "d" });
  expect(ids(r.recent)).toEqual(["a", "b", "d"]);
  expect(ids(r.older)).toEqual(["c"]);
});
it("unread goes to active, then to recent once read", () => {
  const l = [th("a", "p", 90), th("b", "p", 80)];
  const unread = bucketThreads(l, { ...base, read: { b: 80 } });
  expect(ids(unread.active)).toEqual(["a"]);
  expect(ids(unread.recent)).toEqual(["b"]);
  const after = bucketThreads(l, { ...base, read: allRead(l), selected: "a" });
  expect(ids(after.active)).toEqual([]);
  expect(ids(after.recent)).toEqual(["a", "b"]);
});
it("N = 0 puts everything non-live in older, except the selected thread", () => {
  const l = [th("a", "p", 90), th("b", "p", 80)];
  const r = bucketThreads(l, { ...base, read: allRead(l), recentCount: 0, selected: "b" });
  expect(ids(r.recent)).toEqual(["b"]);
  expect(ids(r.older)).toEqual(["a"]);
});
it("hideRead off keeps one list with no recent bucket", () => {
  const l = [th("a", "p", 90), th("b", "p", 80)];
  const r = bucketThreads(l, { ...base, read: allRead(l), hideRead: false });
  expect(ids(r.active)).toEqual(["a", "b"]);
  expect(r.recent).toEqual([]);
});

import { attentionCount } from "./types";
it("counts only threads needing attention", () => {
  const t = (id: string, status: string, updated = 5) => ({ id, status, updated }) as never as { id: string; status: string; updated: number };
  const list = [t("a", "running"), t("b", "done"), t("c", "done"), t("d", "failed"), t("e", "failed"), t("f", "archived")];
  expect(attentionCount(list, { b: 5, c: 1, e: 5 })).toBe(3);
  expect(attentionCount([t("x", "done")], { x: 5 }, () => 1)).toBe(1);
});

it("keeps read pins above live threads without consuming recent slots", () => {
  const l = [th("live", "p", 100), th("recent", "p", 90), { ...th("pin", "p", 10), pinned: true }];
  const r = bucketThreads(l, { ...base, read: { recent: 90, pin: 10 }, recentCount: 1 });
  expect(ids(r.active)).toEqual(["pin", "live"]);
  expect(ids(r.recent)).toEqual(["recent"]);
  expect(r.older).toEqual([]);
  const unpinned = bucketThreads(l.map(t => ({ ...t, pinned: false })), { ...base, read: { recent: 90, pin: 10 }, recentCount: 1 });
  expect(ids(unpinned.older)).toEqual(["pin"]);
});
