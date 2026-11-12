import { useState } from 'react';
import { effortLabel } from './agent-selection';
import { levelMapping, levels, levelLabel, type ModelConfiguration } from './model-levels';
import { providerName } from './types';
import './model-configuration.css';

export function ModelConfigurationSettings({ configuration = {}, providers = [], disabled = false, onSave }: {
  configuration?: ModelConfiguration; providers?: string[]; disabled?: boolean; onSave: (configuration: ModelConfiguration) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ModelConfiguration | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const value = draft ?? configuration;
  const allProviders = [...new Set(['codex', 'claude', ...providers, ...Object.keys(configuration)])];
  const valid = allProviders.every(p => levels.every(l => /^[a-z0-9._/-]*$/i.test(levelMapping(p, l, value).family.trim())));
  return <section className="model-configuration" aria-label="Model configuration">
    <p>Choose what Smart, Normal, and Fast mean for each agent provider. These settings are shared by your Mac and companions, and apply to conversations, Commander, routines, summaries, and other AI work. Custom overrides apply only to the selected session.</p>
    <div className="model-configuration-scroll"><table><caption>Provider model mappings</caption><thead><tr><th scope="col">Provider</th>{levels.map(l => <th scope="col" key={l}>{levelLabel(l)}</th>)}</tr></thead><tbody>
      {allProviders.map(provider => <tr key={provider}><th scope="row">{providerName(provider)}</th>{levels.map(level => {
        const mapping = levelMapping(provider, level, value);
        const update = (patch: Partial<typeof mapping>) => { setDraft(old => ({ ...(old ?? configuration), [provider]: { ...(old ?? configuration)[provider], [level]: { ...mapping, ...patch } } })); setSaved(false); };
        return <td key={level}><label>Model family or ID<input aria-label={`${providerName(provider)} ${levelLabel(level)} model`} value={mapping.family} placeholder="Provider default" maxLength={120} disabled={disabled || saving} onChange={e => update({ family: e.target.value })}/></label>
          <label>Reasoning effort<select aria-label={`${providerName(provider)} ${levelLabel(level)} reasoning effort`} disabled={disabled || saving || !['codex','claude'].includes(provider)} value={mapping.effort} onChange={e => update({ effort: e.target.value })}>{['default','low','medium','high','xhigh','max', ...(provider === 'claude' ? ['ultracode'] : [])].map(e => <option value={e} key={e}>{e === 'default' ? 'Provider default' : effortLabel(e)}</option>)}</select></label>
        </td>;
      })}</tr>)}
    </tbody></table></div>
    <p>Family names such as Astra, Sol, and Luna follow the latest available release. An exact model ID pins that model. Leave a mapping empty to use that provider’s default.</p>
    <button type="button" disabled={disabled || saving || !draft || !valid} onClick={async () => {
      setSaving(true); setError('');
      const next = Object.fromEntries(allProviders.map(p => [p, Object.fromEntries(levels.map(l => { const m = levelMapping(p,l,value); return [l, { ...m, family: m.family.trim().toLowerCase() }]; }))]));
      try { await onSave(next); setDraft(null); setSaved(true); } catch(e) { setError(String(e)); } finally { setSaving(false); }
    }}>{saving ? 'Saving…' : 'Save model configuration'}</button>
    {saved && <p role="status">Model configuration saved for all devices.</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
