import { isLevel, levelChoices } from "./model-levels";
export type AgentSelection = { model: string; effort: string; speed?: string; agent?: string };
export type ServiceTier = { id: string; name: string; description?: string };
export type Model = { model: string; displayName: string; isDefault?: boolean; supportedReasoningEfforts: { reasoningEffort: string }[]; serviceTiers?: ServiceTier[] };
export const defaultSelection: AgentSelection = { model: "", effort: "default" };
export function effortChoices(provider: string, model: string, models: Model[]): string[] {
  if (isLevel(model)) return [];
  if (provider === "claude") return ["low", "medium", "high", "xhigh", "max", "ultracode"];
  if (provider !== "codex") return [];
  const selected = models.find(m => model ? m.model === model : m.isDefault);
  return selected ? selected.supportedReasoningEfforts.map(e => e.reasoningEffort) : ["low", "medium", "high", "xhigh"];
}

export const effortLabel = (effort: string) => (effort === "ultracode" ? "Ultracode (Extra high + workflows)" : effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1));
/** Model choices shown for a provider: the catalog when loaded, else Claude's aliases. Shared by the desktop and iPhone pickers. */
export function advancedModelChoices(provider: string | undefined, models: Model[]): { value: string; label: string }[] {
  const aliases = provider === "claude" ? ["sonnet", "opus", "haiku", "fable"] : [];
  return models.length ? models.map(m => ({ value: m.model, label: m.displayName || m.model })) : aliases.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
}

export function modelChoices(provider: string | undefined, models: Model[]) {
  return [...levelChoices(provider), ...advancedModelChoices(provider, models)];
}

export type SpeedChoice = { value: string; label: string; description?: string };
/** Speed options for a concrete model (resolve presets to their family first). Wire value "fast" maps to Claude `--fast-mode on` or the Codex `priority` service tier. Empty when the model has no fast option. */
export function speedChoices(provider: string, model: string, models: Model[]): SpeedChoice[] {
  if (isLevel(model)) return [];
  if (provider === "claude") return /opus|fable/.test(model) ? [{ value: "fast", label: "Fast mode", description: "Opus and Fable only · higher cost" }] : [];
  if (provider !== "codex") return [];
  const selected = models.find(m => (model ? m.model === model : m.isDefault));
  const tier = selected?.serviceTiers?.find(t => t.id === "priority");
  return tier ? [{ value: "fast", label: tier.name === "Fast" || !tier.name ? "Fast mode" : tier.name, description: tier.description }] : [];
}
export const speedLabel = (speed?: string | null) => (speed === "fast" ? "Fast mode" : "Standard");
