import { test } from "node:test";
import assert from "node:assert/strict";
import { closePane, focusPane, focusedThread, openThreads, otherThread, restoreSplitView, selectThread, singleView, splitPreference, toggleSplit } from "../src/desktop/split-view.ts";

const single = (id) => ({ ...singleView, left: id });
const opened = toggleSplit(single("a"));

test("enabling split keeps the current thread left and focuses an empty right pane", () => {
  assert.deepEqual(opened, { split: true, left: "a", right: "", focus: "right" });
  assert.equal(focusedThread(opened), "");
});
test("split needs a thread to split", () => assert.equal(toggleSplit(singleView), singleView));
test("selecting opens the thread in the focused pane only", () => {
  const view = selectThread(opened, "b");
  assert.deepEqual(view, { split: true, left: "a", right: "b", focus: "right" });
  assert.deepEqual(selectThread(focusPane(view, "left"), "c"), { split: true, left: "c", right: "b", focus: "left" });
});
test("a thread open in the other pane moves focus instead of duplicating", () => {
  const view = selectThread(opened, "b");
  const moved = selectThread(view, "a");
  assert.deepEqual(moved, { split: true, left: "a", right: "b", focus: "left" });
  assert.deepEqual(openThreads(moved), ["a", "b"]);
  assert.equal(otherThread(moved), "b");
});
test("selecting without split replaces the single thread", () => assert.deepEqual(selectThread(single("a"), "b"), single("b")));
test("closing either pane collapses to the other pane's thread", () => {
  const view = selectThread(opened, "b");
  assert.deepEqual(closePane(view, "right"), single("a"));
  assert.deepEqual(closePane(view, "left"), single("b"));
  assert.deepEqual(closePane(opened, "right"), single("a"));
});
test("toggling split off keeps the focused pane's thread", () => {
  const view = selectThread(opened, "b");
  assert.deepEqual(toggleSplit(view), single("b"));
  assert.deepEqual(toggleSplit(focusPane(view, "left")), single("a"));
});
test("clearing a pane leaves it empty and split on", () =>
  assert.deepEqual(selectThread(selectThread(opened, "b"), ""), { split: true, left: "a", right: "", focus: "right" }));
test("focusing the same pane is a no-op and unsplit views ignore focus", () => {
  assert.equal(focusPane(opened, "right"), opened);
  const view = single("a");
  assert.equal(focusPane(view, "right"), view);
});
test("only the split flag and second thread persist", () => {
  const view = selectThread(opened, "b");
  assert.deepEqual(splitPreference(view), { split: true, right: "b" });
  assert.deepEqual(restoreSplitView(splitPreference(view)), { split: true, left: "", right: "b", focus: "left" });
  assert.deepEqual(restoreSplitView(splitPreference(single("a"))), singleView);
  assert.deepEqual(restoreSplitView(null), singleView);
});
