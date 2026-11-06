import { expect, it } from "vitest";
import { threadStats } from "./ThreadStats";
import type { Session } from "./types";
it("counts local-day activity separately from retained lifetime history", () => {
  const now = new Date(2026, 10, 6, 12);
  const at = (date: Date, extra = {}) => ({ updated: date.getTime(), ...extra } as Session);
  const sessions = [at(new Date(2026, 10, 6)), at(new Date(2026, 10, 6, 23, 59)),
    at(new Date(2026, 10, 5, 23, 59)), at(new Date(2026, 10, 7)),
    at(now, { deleted_at: 123 }), at(now, { archived: true })];
  expect(threadStats(sessions, now)).toEqual({ today: 3, lifetime: 6 });
  expect(threadStats([], now)).toEqual({ today: 0, lifetime: 0 });
});
