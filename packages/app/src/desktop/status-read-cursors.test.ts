import { expect, it } from "vitest";
import { statusReadCursors } from "./status-read-cursors";
import { attentionCount, bucketThreads, threadListStatus } from "./types";

it("makes completed replies done and recent without changing real read history", () => {
  const threads = [{ id: "done", status: "done", updated: 10 }, { id: "working", status: "running", updated: 10 }, { id: "approval", status: "waiting", updated: 10 }, { id: "error", status: "failed", updated: 10 }];
  const actual = { error: 10 };
  const display = statusReadCursors(threads, actual, true);
  expect(threadListStatus(threads[0]!, display)).toBe("done");
  const buckets = bucketThreads(threads, { read: display, selected: "", recentCount: 5, scope: "flat", hideRead: true, filter: "all" });
  expect(buckets.active.map(t => t.id)).toEqual(["working", "approval", "error"]);
  expect(buckets.recent.map(t => t.id)).toEqual(["done"]);
  expect(attentionCount(threads, display)).toBe(3);
  expect(actual).toEqual({ error: 10 });
  expect(statusReadCursors(threads, actual, false)).toBe(actual);
  expect(threadListStatus(threads[0]!, actual)).toBe("unread");
});
