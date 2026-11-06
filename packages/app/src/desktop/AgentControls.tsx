import { PopoverDetails } from "./PopoverDetails";
import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Cpu } from "lucide-react";
import { providerName, type Account } from "./types";

export { defaultSelection } from "./agent-selection";
export type { AgentSelection } from "./agent-selection";
import { effortChoices, effortLabel, modelChoices, type AgentSelection, type Model } from "./agent-selection";

export function AgentControls({ account, native, value, onChange, disabled = false, provider = account?.provider, loadModels, iconOnly = false, context = "the next message" }: {
  context?: string; iconOnly?: boolean; account?: Account; native: boolean; value: AgentSelection; onChange: (value: AgentSelection) => void; disabled?: boolean; provider?: string; loadModels?: () => Promise<Model[]>;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [catalog, setCatalog] = useState<{ account: string; models: Model[] }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!expanded || !native || provider !== "codex" || (!loadModels && !account)) return;
    let cancelled = false;
    setError(""); setLoading(true);
    (loadModels ? loadModels() : invoke<Model[]>("account_models", { account: account!.id })).then(models => {
      if (!cancelled) setCatalog({ account: account?.id || provider, models });
    }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, native, account?.id, provider, loadModels]);
  const models = catalog?.account === (account?.id || provider) ? catalog?.models || [] : [];
  const choices = modelChoices(provider, models);
  const known = !value.model || choices.some(m => m.value === value.model);
  const [custom, setCustom] = useState(false);
  const efforts = effortChoices(provider || "", value.model, models);
  return <PopoverDetails className={`agent-controls${iconOnly ? " agent-controls-icon" : ""}`} open={expanded} onDismiss={() => setExpanded(false)} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary aria-label="Model and effort" aria-disabled={disabled || !provider} onClick={e => { if (disabled || !provider) e.preventDefault(); }}>
      {iconOnly && <Cpu size={18} aria-hidden="true"/>}<span className="agent-model-label">{choices.find(choice => choice.value === value.model)?.label || value.model || "Model default"}</span>{value.effort !== "default" && <span className="agent-effort-label">{effortLabel(value.effort)}</span>}<ChevronDown size={12} aria-hidden="true"/>
    </summary>
    <div className="agent-controls-panel">
      <p>{provider ? providerName(provider) : "Choose an account"} · Applies to {context}</p>
      <label htmlFor={`${id}-model`}>Model</label>
      <select id={`${id}-model`} disabled={disabled || !provider} value={custom || !known ? "__custom" : value.model} onChange={e => {
        if (e.target.value === "__custom") { setCustom(true); return; }
        setCustom(false); onChange({ model: e.target.value, effort: "default" });
      }}>
        <option value="">Agent default</option>
        {choices.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        <option value="__custom">Custom model ID…</option>
      </select>
      {(custom || !known) && <input aria-label="Custom model ID" placeholder={`${providerName(provider || "")} model ID`} maxLength={200} value={value.model} disabled={disabled} onChange={e => onChange({ model: e.target.value, effort: "default" })}/>}
      {!!efforts.length && <><label htmlFor={`${id}-effort`}>Reasoning effort</label>
        <select id={`${id}-effort`} disabled={disabled || !provider} value={value.effort} onChange={e => onChange({ ...value, effort: e.target.value })}>
          <option value="default">Agent default</option>
          {[...new Set([...efforts, ...(value.effort !== "default" ? [value.effort] : [])])].map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}
        </select></>}
      {provider && !["codex", "claude"].includes(provider) && <small>Effort control is unavailable for this provider. Enter its model ID under Custom.</small>}
      {loading && <small role="status">Loading available models…</small>}
      {error && <small role="status">Couldn’t load models. You can enter a custom ID. Close and reopen to retry.</small>}
      <small>Model availability and effort support depend on your provider and subscription.</small>
    </div>
  </PopoverDetails>;
}
