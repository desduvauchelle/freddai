import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@freddai/ui/components/dialog';
import { isLevel, levelLabel, levelMapping, levelValue, levels, selectionLevel, type Level, type ModelConfiguration } from './model-levels';
import { advancedModelChoices, effortChoices, effortLabel, speedChoices, speedLabel, type AgentSelection, type Model } from './agent-selection';
import { providerName, type Account } from './types';
import './composer-agent-picker.css';
import { useAccountUsageView } from './useAccountUsage';
import { UsageRing } from './UsageRing';
import { useMediaQuery } from './useMediaQuery';
import { useModelCatalog } from './useModelCatalog';

export const assistantColor = (provider?: string) => provider === 'claude' ? '#d99573' : provider === 'codex' ? '#59b99a' : '#9a91df';
export type AssistantOption = { id: string; label: string; account?: Account; provider?: string; color?: string };

const cap = (text: string) => text ? text[0].toUpperCase() + text.slice(1) : text;
const shortProvider = (provider?: string) => provider === 'claude' ? 'Claude' : providerName(provider || '');
type Step = 'assistants' | 'difficulty' | 'model' | 'thinking' | 'speed';

/** A modal keeps the picker clear of clipped toolbars and mobile keyboards. Wide: assistant + level columns; Custom flips the level column to models and adds a thinking column. Narrow: one tap-only step at a time. */
export function ComposerAgentPicker({ options, agent, onAgentChange, account, provider = account?.provider, native, value, onChange, disabled = false, loadModels, displayLabel, modelConfiguration }: {
  displayLabel?: string; options: AssistantOption[]; agent: string; onAgentChange: (id: string) => void;
  account?: Account; provider?: string; native: boolean; value: AgentSelection;
  onChange: (value: AgentSelection) => void; disabled?: boolean; loadModels?: () => Promise<Model[]>; modelConfiguration?: ModelConfiguration;
}) {
  const [open, setOpen] = useState(false), [step, setStep] = useState<Step>('assistants');
  const [column, setColumn] = useState<'levels' | 'models'>('levels');
  const wide = useMediaQuery('(min-width: 720px)');
  const viewOf = useAccountUsageView();
  const { models } = useModelCatalog({ enabled: open, native, provider, accountId: account?.id, loadModels });
  const selected = options.find(option => option.id === agent);
  const groups = [...new Set(options.map(o => o.account?.provider || o.provider || ''))].sort();
  const color = selected?.account?.color || selected?.color || assistantColor(provider);
  const prov = provider || '';
  const choices = advancedModelChoices(provider, models);
  const preset = isLevel(value.model) || !value.model;
  const presetLevel: Level = selectionLevel(value.model) === 'custom' ? 'normal' : selectionLevel(value.model) as Level;
  const modelLabel = (id: string) => choices.find(c => c.value === id)?.label || cap(id);
  const mapping = (level: Level) => levelMapping(prov, level, modelConfiguration);
  const subtitle = (level: Level) => { const m = mapping(level); return `${m.family ? cap(m.family) : 'Provider default'}${m.effort !== 'default' ? ` · ${effortLabel(m.effort)}` : ''}`; };
  const concreteEfforts = (model: string) => effortChoices(prov, model, models);
  const family = preset ? mapping(presetLevel).family : value.model;
  const efforts = concreteEfforts(family);
  const activeEffort = preset ? mapping(presetLevel).effort : value.effort;
  const concreteSpeeds = (model: string) => speedChoices(prov, model, models);
  const speeds = concreteSpeeds(family);
  const fast = value.speed === 'fast';
  const summary = `${shortProvider(provider)} · ${preset ? `${family ? cap(family) : 'Provider default'} (${levelLabel(presetLevel)})` : modelLabel(value.model)} · ${activeEffort === 'default' ? 'Default' : effortLabel(activeEffort)} thinking${fast ? ` · ${speedLabel('fast')}` : ''}`;
  const triggerLevel = `${preset ? levelLabel(presetLevel) : `${modelLabel(value.model)} · ${value.effort === 'default' ? 'Default' : effortLabel(value.effort)}`}${fast ? ' · Fast' : ''}`;
  const keepSpeed = (model: string) => concreteSpeeds(model).length ? value.speed : undefined;

  const pickAssistant = (id: string) => { if (id !== agent) onAgentChange(id); };
  const pickPreset = (level: Level) => onChange({ ...value, model: levelValue(provider, level), effort: 'default', speed: keepSpeed(mapping(level).family) });
  const pickModel = (id: string) => onChange({ ...value, model: id, effort: concreteEfforts(id).includes(value.effort) ? value.effort : 'default', speed: keepSpeed(id) });
  const pickSpeed = (speed?: string) => onChange({ ...value, speed });
  const pickEffort = (effort: string) => {
    if (preset) { if (effort !== activeEffort) onChange({ ...value, model: family, effort }); } else onChange({ ...value, effort });
  };

  const assistantList = <>{groups.map(group => <section key={group} aria-label={providerName(group) || 'Defaults'}>
    <h3>{group ? providerName(group) : 'Project defaults'}</h3>
    {options.filter(o => (o.account?.provider || o.provider || '') === group).sort((a, b) => a.label.localeCompare(b.label)).map(option => {
      const usage = option.account ? viewOf(option.account) : undefined;
      return <button type="button" key={option.id} aria-label={option.label} aria-pressed={option.id === agent} disabled={disabled} onClick={() => { pickAssistant(option.id); if (!wide) setStep('difficulty'); }}>
        {usage && <UsageRing remaining={usage.remaining} color={option.account!.color} stale={usage.stale} size={28}/>}
        <span className="composer-agent-label"><strong style={{ color: option.account?.color || option.color || assistantColor(group) }}>{option.label}</strong>{usage && <small className={usage.isError ? 'is-error' : undefined}>{usage.text}</small>}</span>{option.id === agent && <Check size={16}/>}
      </button>;
    })}
  </section>)}</>;
  const presetButton = (level: Level, pressed: boolean, onClick: () => void) => <button type="button" key={level} aria-label={levelLabel(level)} aria-pressed={pressed} disabled={disabled || !provider} onClick={onClick}>
    <span className="composer-agent-label"><strong>{levelLabel(level)}</strong><small>{subtitle(level)}</small></span>
  </button>;
  const effortButtons = (current: string, locked: boolean, onPick: (effort: string) => void) => efforts.length
    ? <div className="composer-agent-efforts">{['default', ...efforts].map(effort => <button type="button" key={effort} aria-pressed={current === effort} disabled={disabled || locked} onClick={() => onPick(effort)}>
      <span className="composer-agent-label"><strong>{effort === 'default' ? 'Default' : effortLabel(effort)}</strong></span></button>)}</div>
    : <p className="composer-agent-muted">Not configurable for {providerName(prov)}</p>;
  const speedButtons = (onPick: (speed?: string) => void) => <div className="composer-agent-efforts">
    <button type="button" aria-pressed={!fast} disabled={disabled} onClick={() => onPick(undefined)}><span className="composer-agent-label"><strong>Standard</strong></span></button>
    {speeds.map(s => <button type="button" key={s.value} aria-pressed={value.speed === s.value} disabled={disabled} onClick={() => onPick(s.value)}>
      <span className="composer-agent-label"><strong>{s.label}</strong>{s.description && <small>{s.description}</small>}</span></button>)}</div>;
  const modelButtons = (pressedId: string | undefined, onPick: (id: string) => void) => choices.map(c => <button type="button" key={c.value} aria-pressed={pressedId === c.value} disabled={disabled} onClick={() => onPick(c.value)}>
    <span className="composer-agent-label"><strong>{c.label}</strong></span></button>);

  const customPath = step === 'model' || step === 'thinking' || step === 'speed';
  const hasThinking = !!concreteEfforts(preset ? choices[0]?.value || '' : value.model).length;
  const hasSpeed = preset ? choices.some(c => concreteSpeeds(c.value).length) : !!concreteSpeeds(value.model).length;
  const total = customPath ? 3 + (hasThinking ? 1 : 0) + (hasSpeed ? 1 : 0) : 2;
  const titles: Record<Step, string> = { assistants: 'Choose assistant', difficulty: 'Choose difficulty', model: 'Choose model', thinking: 'Choose thinking', speed: 'Choose speed' };
  const stepNumber = { assistants: 1, difficulty: 2, model: 3, thinking: 4, speed: hasThinking ? 5 : 4 }[step];
  const customizing = wide && column === 'models' && !!choices.length;
  const columnCount = (options.length ? 1 : 0) + 1 + (customizing ? 1 : 0);
  const wideTitle = customizing ? 'Choose assistant, model and thinking' : 'Choose assistant and level';
  const description = wide ? `${selected?.label || 'Project defaults'} · ${customizing ? 'Pick a model, then its thinking.' : 'Pick a level, or choose Custom.'}`
    : step === 'assistants' ? 'Step 1 of 2 · Choose a connection, then its difficulty.' : `Step ${stepNumber} of ${total} · ${selected?.label || 'Project defaults'}`;
  const back = (to: Step, label: string) => <button type="button" onClick={() => setStep(to)}>{label}</button>;

  const narrowBody = step === 'assistants' ? assistantList : step === 'difficulty' ? <>
    {back('assistants', '← Back to assistants')}
    <div role="group" aria-label="Difficulty">
      {levels.map(level => presetButton(level, preset && presetLevel === level, () => { pickPreset(level); setOpen(false); }))}
      {!!choices.length && <button type="button" aria-pressed={!preset} disabled={disabled || !provider} onClick={() => setStep('model')}><span className="composer-agent-label"><strong>Custom</strong><small>Pick a model and thinking</small></span></button>}
    </div></> : step === 'model' ? <>
    {back('difficulty', '← Back')}
    <div role="group" aria-label="Model">{modelButtons(preset ? undefined : value.model, id => { pickModel(id); if (concreteEfforts(id).length) setStep('thinking'); else if (concreteSpeeds(id).length) setStep('speed'); else setOpen(false); })}</div></> : step === 'thinking' ? <>
    {back('model', '← Back')}
    {effortButtons(activeEffort, false, effort => { pickEffort(effort); if (concreteSpeeds(family).length) setStep('speed'); else setOpen(false); })}</> : <>
    {back(hasThinking ? 'thinking' : 'model', '← Back')}
    <div role="group" aria-label="Speed">{speedButtons(speed => { pickSpeed(speed); setOpen(false); })}</div></>;

  return <Dialog open={open} onOpenChange={next => { setOpen(next); if (next) { setStep(!wide && options.length ? 'assistants' : 'difficulty'); setColumn(!preset ? 'models' : 'levels'); } }}>
    <DialogTrigger asChild><button type="button" className="composer-agent-trigger" aria-label="Assistant and difficulty" disabled={disabled}>
      <span className="composer-agent-trigger-label"><strong style={{ color }}>{displayLabel || selected?.label || 'Project defaults'}</strong>{" "}<span className="composer-agent-trigger-level">· {triggerLevel}</span></span><ChevronDown size={12}/>
    </button></DialogTrigger>
    <DialogContent className={`composer-agent-modal${wide ? ' is-wide' : ''}`} data-columns={wide ? columnCount : undefined}>
      <DialogTitle>{wide ? wideTitle : titles[step]}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {wide ? <>
        <div className="composer-agent-columns" data-columns={columnCount}>
          {!!options.length && <div className="composer-agent-menu composer-agent-column" role="group" aria-label="Assistant"><h2>Assistant</h2>{assistantList}</div>}
          {customizing ? <div className="composer-agent-menu composer-agent-column" role="group" aria-label="Model">
            <button type="button" className="composer-agent-back" onClick={() => setColumn('levels')}>← Levels</button>
            <h2>Model</h2>{modelButtons(preset ? undefined : value.model, pickModel)}
          </div> : <div className="composer-agent-menu composer-agent-column" role="group" aria-label="Difficulty"><h2>Level</h2>
            {levels.map(level => presetButton(level, preset && presetLevel === level, () => pickPreset(level)))}
            {!!choices.length && <button type="button" aria-pressed={!preset} disabled={disabled || !provider} onClick={() => setColumn('models')}><span className="composer-agent-label"><strong>Custom</strong><small>Pick a model and thinking</small></span></button>}
          </div>}
          {customizing && <div className="composer-agent-menu composer-agent-column" role="group" aria-label="Thinking"><h2>Thinking</h2>{effortButtons(activeEffort, preset && !family, pickEffort)}
            {!!speeds.length && <div role="group" aria-label="Speed"><h2>Speed</h2>{speedButtons(pickSpeed)}</div>}</div>}
        </div>
        <div className="composer-agent-footer"><span data-testid="composer-agent-summary">{summary}</span><button type="button" className="composer-agent-done" onClick={() => setOpen(false)}>Done</button></div>
      </> : <div className="composer-agent-menu">{narrowBody}</div>}
    </DialogContent>
  </Dialog>;
}
