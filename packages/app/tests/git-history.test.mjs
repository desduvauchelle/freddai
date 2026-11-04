import { test } from "node:test";
import assert from "node:assert/strict";
import { aheadBehindLabel, commitDate, groupChanges, layoutGraph } from "../src/desktop/git-history.ts";

test("changes are grouped in a stable order and empty groups are dropped", () => {
  const c = (group, path) => ({ group, path, orig_path: null, status: "modified", code: "M" });
  const groups = groupChanges([c("untracked", "u"), c("staged", "s"), c("unstaged", "x"), c("staged", "t")]);
  assert.deepEqual(groups.map(g => [g.group, g.items.length]), [["staged", 2], ["unstaged", 1], ["untracked", 1]]);
  assert.deepEqual(groupChanges([]), []);
});

test("ahead/behind label covers no upstream, in sync, and diverged", () => {
  assert.equal(aheadBehindLabel({ upstream: null, ahead: 0, behind: 0 }), "No upstream");
  assert.equal(aheadBehindLabel({ upstream: "origin/main", ahead: 0, behind: 0 }), "Up to date with origin/main");
  assert.equal(aheadBehindLabel({ upstream: "origin/main", ahead: 2, behind: 1 }), "2 ahead, 1 behind of origin/main");
  assert.equal(aheadBehindLabel({ upstream: "origin/main", ahead: 0, behind: 3 }), "3 behind of origin/main");
});

test("commit dates are relative when recent and fall back to the raw value when unparseable", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  assert.equal(commitDate("2026-11-03T11:30:00Z", now), "30m ago");
  assert.equal(commitDate("2026-11-03T09:00:00Z", now), "3h ago");
  assert.equal(commitDate("2026-11-01T12:00:00Z", now), "2d ago");
  assert.equal(commitDate("garbage", now), "garbage");
});

test("graph preserves branch lanes through a merge and rejoins shared ancestors", () => {
  const commit = (hash, parents) => ({ hash, parents, refs: [], subject: hash, author: "A", date: "" });
  const rows = layoutGraph([commit("merge", ["left", "right"]), commit("left", ["root"]), commit("right", ["root"]), commit("root", [])]);
  assert.equal(rows[0].edges.length, 2);
  assert.notEqual(rows[0].edges[0].to, rows[0].edges[1].to);
  assert.equal(rows[2].lane, 1);
  assert.equal(rows[2].edges.find(e => e.from === 1).to, 0);
  assert.equal(rows[3].incoming, true);
  assert.deepEqual(rows[3].edges, []);
});
