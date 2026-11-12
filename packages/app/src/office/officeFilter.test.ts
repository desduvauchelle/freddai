import { expect, it } from "vitest";
import { recentProjects, RECENT_WINDOW_MS, readRecentOnly, writeRecentOnly, HOME_RECENT_ONLY_KEY, OFFICE_RECENT_ONLY_KEY } from "./officeFilter";

const NOW = new Date(2026, 10, 10, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const p = (id: string, kind?: "commander") => ({ id, kind });
const t = (project: string, over: Record<string, unknown> = {}) => ({ id: `${project}-t`, project, status: "done", pending: null, updated: NOW - 30 * DAY, ...over }) as never;
const ids = (r: { id: string }[]) => r.map(x => x.id);

it("keeps a project with a thread updated in the last 7 days", () => {
  expect(ids(recentProjects([p("a")], [t("a", { updated: NOW - 6 * DAY })], [], NOW))).toEqual(["a"]);
});
it("keeps a project when only last_user_message_at or turn_started_at is recent", () => {
  expect(ids(recentProjects([p("a"), p("b")], [t("a", { last_user_message_at: NOW - DAY }), t("b", { turn_started_at: NOW - DAY })], [], NOW))).toEqual(["a", "b"]);
});
it("keeps a project with an enabled schedule even if all threads are old", () => {
  expect(ids(recentProjects([p("a")], [t("a")], [{ project: "a", enabled: true }], NOW))).toEqual(["a"]);
});
it("keeps a project with a running, waiting or queued old thread", () => {
  const r = recentProjects([p("a"), p("b"), p("c")], [t("a", { status: "running" }), t("b", { pending: { id: 1 } }), t("c", { id: "q" })], [], NOW, new Set(["q"]));
  expect(ids(r)).toEqual(["a", "b", "c"]);
});
it("hides an old project with no schedule and no live thread; ignores disabled schedules, deleted threads and window edge", () => {
  const r = recentProjects([p("old"), p("dis"), p("del"), p("edge")], [t("old"), t("dis"), t("del", { updated: NOW, deleted_at: NOW }), t("edge", { updated: NOW - RECENT_WINDOW_MS - 1 })], [{ project: "dis", enabled: false }], NOW);
  expect(r).toEqual([]);
});
it("never hides the commander project and preserves order", () => {
  expect(ids(recentProjects([p("a"), p("boss", "commander"), p("b")], [t("b", { updated: NOW })], [], NOW))).toEqual(["boss", "b"]);
});
it("fails open when sessions or schedules are not loaded, or a timestamp is unusable", () => {
  expect(ids(recentProjects([p("a")], undefined, [], NOW))).toEqual(["a"]);
  expect(ids(recentProjects([p("a")], [t("a")], undefined, NOW))).toEqual(["a"]);
  expect(ids(recentProjects([p("a")], [t("a", { updated: undefined })], [], NOW))).toEqual(["a"]);
});

it("persists recent-only per storage key, defaulting to on", () => {
  localStorage.clear();
  expect(readRecentOnly(HOME_RECENT_ONLY_KEY)).toBe(true);
  writeRecentOnly(false, HOME_RECENT_ONLY_KEY);
  expect(localStorage.getItem(HOME_RECENT_ONLY_KEY)).toBe("false");
  expect(readRecentOnly(HOME_RECENT_ONLY_KEY)).toBe(false);
  expect(readRecentOnly()).toBe(true);
  expect(localStorage.getItem(OFFICE_RECENT_ONLY_KEY)).toBeNull();
  localStorage.clear();
});
