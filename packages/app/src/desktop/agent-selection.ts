export type AgentSelection = { model: string; effort: string };
export type Model = { model: string; displayName: string; isDefault?: boolean; supportedReasoningEfforts: { reasoningEffort: string }[] };
export const defaultSelection: AgentSelection = { model: "", effort: "default" };
export function effortChoices(provider: string, model: string, models: Model[]): string[] {
  if (provider === "claude") return ["low", "medium", "high", "xhigh", "max"];
  if (provider !== "codex") return [];
  const selected = models.find(m => model ? m.model === model : m.isDefault);
  return selected ? selected.supportedReasoningEfforts.map(e => e.reasoningEffort) : ["low", "medium", "high", "xhigh"];
}

