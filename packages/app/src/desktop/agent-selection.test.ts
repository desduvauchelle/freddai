import { expect, it } from "vitest";
import { effortChoices, effortLabel, speedChoices, speedLabel, type Model } from "./agent-selection";

const model = (extra: Partial<Model>): Model => ({ model: "m", displayName: "M", supportedReasoningEfforts: [], ...extra });
it("claude: fast only for opus and fable", () => {
  expect(speedChoices("claude", "opus", []).map(c => c.value)).toEqual(["fast"]);
  expect(speedChoices("claude", "fable", [])[0].label).toBe("Fast mode");
  expect(speedChoices("claude", "sonnet", [])).toEqual([]);
});
it("presets and other providers have none", () => {
  expect(speedChoices("claude", "freddai-level:normal", [])).toEqual([]);
  expect(speedChoices("gemini", "x", [])).toEqual([]);
});
it("codex: reads the priority service tier from the catalog", () => {
  const tier = { id: "priority", name: "Fast", description: "2x speed" };
  expect(speedChoices("codex", "m", [model({ serviceTiers: [tier] })])).toEqual([{ value: "fast", label: "Fast mode", description: "2x speed" }]);
  expect(speedChoices("codex", "m", [model({})])).toEqual([]);
  expect(speedChoices("codex", "m", [model({ serviceTiers: [{ id: "flex", name: "Flex" }] })])).toEqual([]);
  expect(speedChoices("codex", "", [model({ isDefault: true, serviceTiers: [tier] })])).toHaveLength(1);
});
it("labels", () => { expect(speedLabel("fast")).toBe("Fast mode"); expect(speedLabel()).toBe("Standard"); });

it("offers Ultracode only for Claude and describes its workflow behavior", () => {
  expect(effortChoices("claude", "opus", [])).toContain("ultracode");
  expect(effortChoices("codex", "m", [])).not.toContain("ultracode");
  expect(effortLabel("ultracode")).toBe("Ultracode (Extra high + workflows)");
});
