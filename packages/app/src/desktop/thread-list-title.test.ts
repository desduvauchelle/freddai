import { expect, it } from "vitest";
import { threadListTitle } from "./thread-list-title";
it("recovers shortened prompt titles for width-based CSS truncation", () => {
  const text = "I should be able to select the coding assistant for every new conversation";
  expect(threadListTitle("I should be able to select the coding…", [{ role: "user", text }])).toBe(text);
  expect(threadListTitle("select the coding...", [{ role: "user", text: "Can you please select the coding assistant for this project" }])).toBe("select the coding assistant for this project");
});
it("preserves named titles and titles without a matching original message", () => {
  for (const title of ["Scheduled task creation", "A different name…", "Automatic session thread naming"]) {
    expect(threadListTitle(title, [{ role: "user", text: "A long original prompt" }])).toBe(title);
  }
  expect(threadListTitle("Missing…", [])).toBe("Missing…");
});
