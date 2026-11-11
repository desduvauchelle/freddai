import { describe, expect, it } from "vitest";
import { resetLabel, usageErrorSummary, usageSummary, windowKind } from "./usage";

const now = new Date(2026, 10, 10, 12, 0, 0).getTime();
const at = (offsetMs: number) => (now + offsetMs) / 1000;
const hm = (s: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000));
const w = (label: string, used: number, resets: number | null = null, window?: "session" | "weekly" | "other") => ({ label, used_percent: used, resets_at: resets, window });

describe("windowKind", () => {
  it("prefers explicit window, else classifies by label", () => {
    expect(windowKind(w("Weekly", 1, null, "session"))).toBe("session");
    expect(windowKind(w("Session", 1))).toBe("session");
    expect(windowKind(w("5-hour window", 1))).toBe("session");
    expect(windowKind(w("All models", 1))).toBe("other");
    expect(windowKind(w("7-day", 1))).toBe("weekly");
    expect(windowKind(w("Gemini · Weekly", 1))).toBe("weekly");
  });
});

describe("resetLabel", () => {
  it("formats by distance", () => {
    expect(resetLabel(null, now)).toBe("reset unknown");
    expect(resetLabel(NaN, now)).toBe("reset unknown");
    expect(resetLabel(at(-1000), now)).toBe("resetting now");
    const soon = at(3 * 3600000);
    expect(resetLabel(soon, now)).toBe(`resets ${hm(soon)}`);
    const week = at(3 * 86400000);
    const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(week * 1000));
    expect(resetLabel(week, now)).toBe(`resets ${day} ${hm(week)}`);
    const far = at(20 * 86400000);
    expect(resetLabel(far, now)).toMatch(/^resets \d{1,2} \S+$/);
  });
});

describe("usageSummary", () => {
  it("claude: weekly is All models, not Fable only", () => {
    const s = usageSummary([w("Fable only", 90, null, "weekly"), w("All models", 12, null, "weekly"), w("Session", 39, null, "session")], now);
    expect(s.session?.label).toBe("Session");
    expect(s.weekly?.label).toBe("All models");
    expect(s.limiting?.label).toBe("Fable only");
    expect(s.lines.map(l => l.label)).toEqual(["Session", "Fable only", "All models"]);
  });
  it("codex", () => {
    const s = usageSummary([w("Weekly", 80), w("Session", 25)], now);
    expect(s.session?.remaining).toBe(75);
    expect(s.weekly?.remaining).toBe(20);
  });
  it("antigravity picks lowest weekly", () => {
    const s = usageSummary([w("Gemini · Session", 10), w("Gemini · Weekly", 20), w("Claude & GPT · Weekly", 70), w("Argon · Weekly", 5)], now);
    expect(s.session?.label).toBe("Gemini · Session");
    expect(s.weekly?.label).toBe("Claude & GPT · Weekly");
  });
  it("handles empty", () => {
    expect(usageSummary([], now)).toEqual({ session: null, weekly: null, limiting: null, lines: [] });
  });
});

describe("usageErrorSummary", () => {
  it("maps errors", () => {
    expect(usageErrorSummary("x", "gemini")).toBe("Usage not supported");
    expect(usageErrorSummary("usage not supported", "claude")).toBe("Usage not supported");
    expect(usageErrorSummary("token expired", "claude")).toBe("Sign-in expired · reconnect");
    expect(usageErrorSummary("Rate limit hit", "codex")).toBe("Rate limited · retry later");
    expect(usageErrorSummary("request timed out", "codex")).toBe("Usage timed out");
    expect(usageErrorSummary(null, "antigravity")).toBe("Usage unavailable");
  });
});
