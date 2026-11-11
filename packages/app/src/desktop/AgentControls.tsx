import { useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, Cpu } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@freddai/ui/components/select';
import { DashboardSelect } from './DashboardSelect';
import { PopoverDetails } from './PopoverDetails';
import { advancedModelChoices, effortChoices, effortLabel, type AgentSelection, type Model } from './agent-selection';
import { levelChoices, levelName, selectionLevel } from './model-levels';
import { providerName, type Account } from './types';
import './dashboard-launch-controls.css';
export { defaultSelection } from './agent-selection';
export type { AgentSelection } from './agent-selection';

export function AgentControls({ account, native, value, onChange, disabled = false, provider = account?.provider, loadModels, iconOnly = false, inline = false, context = 'this session' }: {
  context?: string; inline?: boolean; iconOnly?: boolean; account?: Account; native: boolean; value: AgentSelection; onChange: (value: AgentSelection) => void; disabled?: boolean; provider?: string; loadModels?: () => Promise<Model[]>;
}) {
  const id = useId(), [expanded, setExpanded] = useState(false), [custom, setCustom] = useState(false);
  const [catalog, setCatalog] = useState<{ key: string; models: Model[] }>(), [error, setError] = useState('');
  const key = account?.id || provider || '';
  const level = custom ? 'custom' : selectionLevel(value.model);
  useEffect(() => {
    if ((!(expanded && level === 'custom') && !inline) || level !== 'custom' || !native || provider !== 'codex' || (!loadModels && !account)) return;
    let cancelled = false;
    setError('');
    (loadModels ? loadModels() : invoke<Model[]>('account_models', { account: account!.id })).then(models => {
      if (!cancelled) setCatalog({ key, models });
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [expanded, inline, level, native, key, provider, loadModels]);
  const models = catalog?.key === key ? catalog.models : [];
  const choices = advancedModelChoices(provider, models), efforts = effortChoices(provider || '', level === 'custom' && selectionLevel(value.model) === 'custom' ? value.model : '', models);
  const choose = (next: string) => {
    setCustom(next === 'custom');
    if (next !== 'custom') onChange({ ...value, model: next, effort: 'default' });
    else if (selectionLevel(value.model) !== 'custom') onChange({ ...value, model: choices[0]?.value || 'freddai-custom:', effort: 'default' });
  };
  const selectedLevel = level === 'custom' ? 'custom' : `freddai-level:${level}`;
  const customPanel = level === 'custom' && <div className="agent-controls-panel">
    <label htmlFor={`${id}-model`}>Specific model</label><input id={`${id}-model`} aria-label="Custom model ID" list={`${id}-models`} value={selectionLevel(value.model) === 'custom' && value.model !== 'freddai-custom:' ? value.model : ''} placeholder={`${providerName(provider || '')} model ID`} maxLength={200} disabled={disabled} onChange={e => { setCustom(true); onChange({ ...value, model: e.target.value || 'freddai-custom:', effort: value.effort }); }}/>
    <datalist id={`${id}-models`}>{choices.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</datalist>
    {!!efforts.length && <><label htmlFor={`${id}-effort`}>Reasoning effort</label><select id={`${id}-effort`} disabled={disabled} value={value.effort} onChange={e => onChange({ ...value, effort: e.target.value })}><option value="default">Provider default</option>{[...new Set([...efforts, ...(value.effort !== 'default' ? [value.effort] : [])])].map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}</select></>}
    {error && <small role="status">Couldn’t load available models. You can enter a model ID.</small>}
    <small>Custom model and effort apply to {context}.</small>
  </div>;
  const options = [...levelChoices(provider), { value: 'custom', label: 'Custom' }];
  if (inline) return <div className="dashboard-agent-controls"><DashboardSelect label="Difficulty" value={selectedLevel} onChange={choose} disabled={disabled || !provider} options={options}/>{customPanel}</div>;
  const label = level === 'custom' ? 'Custom' : levelName(value.model);
  const customId = selectionLevel(value.model) === 'custom' && value.model !== 'freddai-custom:' ? value.model : '';
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
      <summary aria-label="Custom model" aria-disabled={disabled || !provider} onClick={e => { if (disabled || !provider) e.preventDefault(); }}><span className="agent-model-label">{customId || 'Choose model…'}</span><ChevronDown size={12}/></summary>
      {customPanel}
    </PopoverDetails>}
  </span>;
}
