import { useId, useState } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@freddai/ui/components/select';
import { DashboardSelect } from './DashboardSelect';
import { PopoverDetails } from './PopoverDetails';
import { advancedModelChoices, effortChoices, effortLabel, speedChoices, speedLabel, type AgentSelection, type Model } from './agent-selection';
import { levelChoices, levelName, selectionLevel } from './model-levels';
import { providerName, type Account } from './types';
import { useModelCatalog } from './useModelCatalog';
import './dashboard-launch-controls.css';
export { defaultSelection } from './agent-selection';
export type { AgentSelection } from './agent-selection';

export function AgentControls({ account, native, value, onChange, disabled = false, provider = account?.provider, loadModels, iconOnly = false, inline = false, context = 'this session' }: {
  context?: string; inline?: boolean; iconOnly?: boolean; account?: Account; native: boolean; value: AgentSelection; onChange: (value: AgentSelection) => void; disabled?: boolean; provider?: string; loadModels?: () => Promise<Model[]>;
}) {
  const id = useId(), [expanded, setExpanded] = useState(false), [custom, setCustom] = useState(false);
  const { models, error } = useModelCatalog({ enabled: true, native, provider, accountId: account?.id, loadModels });
  const level = custom ? 'custom' : selectionLevel(value.model);
  const choices = advancedModelChoices(provider, models);
  const concrete = selectionLevel(value.model) === 'custom' && value.model !== 'freddai-custom:' ? value.model : '';
  const efforts = effortChoices(provider || '', concrete, models);
  const speeds = speedChoices(provider || '', concrete, models);
  const choose = (next: string) => {
    setCustom(next === 'custom');
    if (next !== 'custom') onChange({ ...value, model: next, effort: 'default', speed: undefined });
    else if (!concrete && choices[0]) onChange({ ...value, model: choices[0].value, effort: 'default', speed: undefined });
  };
  const pickModel = (model: string) => onChange({ ...value, model, effort: effortChoices(provider || '', model, models).includes(value.effort) ? value.effort : 'default', speed: speedChoices(provider || '', model, models).length ? value.speed : undefined });
  const selectedLevel = level === 'custom' ? 'custom' : `freddai-level:${level}`;
  const customPanel = level === 'custom' && <div className="agent-controls-panel">
    <label htmlFor={`${id}-model`}>Specific model</label>
    <select id={`${id}-model`} aria-label="Model" disabled={disabled} value={concrete} onChange={e => pickModel(e.target.value)}>
      {!concrete && <option value="" disabled>Choose a model…</option>}
      {concrete && !choices.some(m => m.value === concrete) && <option value={concrete}>{concrete}</option>}
      {choices.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
    {!!efforts.length && <><label htmlFor={`${id}-effort`}>Reasoning effort</label><select id={`${id}-effort`} disabled={disabled} value={value.effort} onChange={e => onChange({ ...value, effort: e.target.value })}><option value="default">Provider default</option>{[...new Set([...efforts, ...(value.effort !== 'default' ? [value.effort] : [])])].map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}</select></>}
    {!!speeds.length && <><label htmlFor={`${id}-speed`}>Speed</label><select id={`${id}-speed`} aria-label="Speed" disabled={disabled} value={value.speed === 'fast' ? 'fast' : ''} onChange={e => onChange({ ...value, speed: e.target.value || undefined })}><option value="">{speedLabel()}</option>{speeds.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></>}
    {error && <small role="status">Couldn’t load available models: {error}</small>}
    <small>Custom model and effort apply to {context}.</small>
  </div>;
  const options = [...levelChoices(provider), ...(choices.length || level === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])];
  if (inline) return <div className="dashboard-agent-controls"><DashboardSelect label="Difficulty" value={selectedLevel} onChange={choose} disabled={disabled || !provider} options={options}/> {customPanel}</div>;
  const label = level === 'custom' ? 'Custom' : levelName(value.model);
  return <span className="agent-controls-group">
    <Select value={selectedLevel} onValueChange={choose} disabled={disabled || !provider}>
      <SelectTrigger size="sm" className={`agent-controls-select${iconOnly ? ' agent-controls-icon' : ''}`} aria-label="Agent difficulty" title={`${providerName(provider || '')} · ${context}`}>
        {iconOnly && <Cpu size={18}/>}<SelectValue><span className="agent-model-label">{label}</span></SelectValue>
      </SelectTrigger>
      <SelectContent className="dev-popup" position="popper" side="top" align="start">
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {level === 'custom' && <PopoverDetails className="agent-controls agent-controls-custom" open={expanded} onDismiss={() => setExpanded(false)} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary aria-label="Custom model" aria-disabled={disabled || !provider} onClick={e => { if (disabled || !provider) e.preventDefault(); }}><span className="agent-model-label">{concrete || 'Choose model…'}</span><ChevronDown size={12}/></summary>
      {customPanel}
    </PopoverDetails>}
  </span>;
}
