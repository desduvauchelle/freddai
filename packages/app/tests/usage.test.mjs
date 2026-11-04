import { test } from "node:test";
import assert from "node:assert/strict";
import { limitingWindow, resetCountdown } from "../src/desktop/usage.ts";

test("footer reset belongs to the allowance with least capacity", () => {
  const windows = [{label:"5 hours",used_percent:10,resets_at:100}, {label:"7 days",used_percent:68,resets_at:200}];
  assert.equal(limitingWindow(windows), windows[1]);
  assert.equal(limitingWindow([]), undefined);
});
test("reset countdown handles missing, due, and future timestamps", () => {
  assert.equal(resetCountdown(null, 0), "Reset unavailable");
  assert.equal(resetCountdown(undefined, 0), "Reset unavailable");
  assert.equal(resetCountdown(0, 0), "Reset due · updating");
  assert.equal(resetCountdown(61, 0), "2m until reset");
  assert.equal(resetCountdown(3660, 0), "1h until reset");
  assert.equal(resetCountdown(176400, 0), "2d until reset");
});
