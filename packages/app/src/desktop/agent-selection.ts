export type AgentSelection = { model: string; effort: string };
export type Model = { model: string; displayName: string; isDefault?: boolean; supportedReasoningEfforts: { reasoningEffort: string }[] };
export const defaultSelection: AgentSelection = { model: "", effort: "default" };
export function effortChoices(provider: string, model: string, models: Model[]): string[] {
  if (provider === "claude") return ["low", "medium", "high", "xhigh", "max"];
  if (provider !== "codex") return [];
  const selected = models.find(m => model ? m.model === model : m.isDefault);
  return selected ? selected.supportedReasoningEfforts.map(e => e.reasoningEffort) : ["low", "medium", "high", "xhigh"];
}

export const effortLabel = (effort: string) => (effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1));
/** Model choices shown for a provider: the catalog when loaded, else Claude's aliases. Shared by the desktop and iPhone pickers. */
export function modelChoices(provider: string | undefined, models: Model[]): { value: string; label: string }[] {
  const aliases = provider === "claude" ? ["sonnet", "opus", "haiku", "fable"] : [];
  return models.length ? models.map(m => ({ value: m.model, label: m.displayName || m.model })) : aliases.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
}
