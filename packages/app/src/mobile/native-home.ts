import { assistantColor } from '../desktop/ComposerAgentPicker';
import { providerName } from '../desktop/types';
import { levelLabel, levelMapping, levelName, levels, levelValue, selectionLevel, type ModelConfiguration } from "../desktop/model-levels";
import { agentDisplayName, type PermissionMode } from '../desktop/types';
import { advancedModelChoices, effortChoices, effortLabel, speedChoices, type AgentSelection, type Model } from '../desktop/agent-selection';
import type { CompanionProject } from './companion';
import { formatProjectName } from '../projectName';
import type { NativeFile, PickerOption } from './native-shell';

/** Pure helpers behind the iPhone "new thread" home and the agent/model pills. */

const LAST_PROJECT_KEY = 'freddai.companion.lastProject';
export const savedLastProject = (): string => { try { return localStorage.getItem(LAST_PROJECT_KEY) || ''; } catch { return ''; } };
export const saveLastProject = (id: string) => { try { if (id) localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* Last-used project is a convenience only. */ } };

const LAST_ASSISTANT_KEY = 'freddai.companion.lastAssistant';
/** The coding agent last used for a project's new threads; callers must validate it against the project's current assistants. */
export const savedLastAssistant = (project: string): string => { try { return project ? localStorage.getItem(`${LAST_ASSISTANT_KEY}.${project}`) || '' : ''; } catch { return ''; } };
export const saveLastAssistant = (project: string, assistant?: string) => { try { if (project && assistant) localStorage.setItem(`${LAST_ASSISTANT_KEY}.${project}`, assistant); } catch { /* Last-used agent is a convenience only. */ } };
/** Persisted last-used agent for a project, or '' when it is unset or no longer offered. */
export const lastAssistantFor = (project?: CompanionProject): string => {
  const id = project ? savedLastAssistant(project.id) : '';
  return id && project?.assistants?.some(a => a.id === id) ? id : '';
};

const CONTROLS_KEY = 'freddai.companion.controls';
/** Model/effort last used per `new:<project>:<assistant>:<provider>` key. */
export const savedControls = (): Record<string, AgentSelection> => {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTROLS_KEY) || '{}');
    return Object.fromEntries(Object.entries(raw as Record<string, AgentSelection>).filter(([k, v]) => k.startsWith('new:') && typeof v?.model === 'string' && typeof v?.effort === 'string'));
  } catch { return {}; }
};
export const saveControls = (controls: Record<string, { selection: AgentSelection }>) => {
  try {
    const next = Object.fromEntries(Object.entries(controls).filter(([k]) => k.startsWith('new:')).map(([k, v]) => [k, { model: v.selection.model, effort: v.selection.effort, ...(v.selection.speed === 'fast' ? { speed: 'fast' } : {}) }]));
    localStorage.setItem(CONTROLS_KEY, JSON.stringify(next));
  } catch { /* Last-used model is a convenience only. */ }
};

/** First of the preferred project ids that can start threads, else the first startable project. */
export function pickNewProject(projects: CompanionProject[], ...preferred: string[]): string {
  return preferred.find(id => !!id && projects.some(p => p.id === id && p.canStart)) ?? projects.find(p => p.canStart)?.id ?? '';
}

export const assistantLabel = (assistant: { name: string; provider: string }) => agentDisplayName(assistant);
export const projectOptions = (projects: CompanionProject[], uppercase?: boolean): PickerOption[] =>
  projects.map(p => ({ id: p.id, label: formatProjectName(p.name, uppercase), detail: p.canStart ? undefined : 'Not ready on your Mac', disabled: !p.canStart }));
export const assistantOptions = (project?: CompanionProject): PickerOption[] =>
  (project?.assistants ?? []).map(a => ({ id: a.id, label: assistantLabel(a) }));

const familyLabel = (family: string) => family ? family[0].toUpperCase() + family.slice(1) : 'Provider default';
/** Whether a provider offers concrete models behind the presets (Claude aliases, Codex catalog). */
export const hasConcreteModels = (provider: string | undefined, models: Model[]) => advancedModelChoices(provider, models).length > 0;
/** Smart/Normal/Fast with the family each resolves to; "Custom" only when concrete models exist. `custom` overrides that check when the catalog is not loaded yet. */
export const modelOptions = (provider: string | undefined, models: Model[], configuration: ModelConfiguration = {}, custom = hasConcreteModels(provider, models)): PickerOption[] => [
  ...levels.map(level => ({ id: levelValue(provider, level), label: levelLabel(level), detail: familyLabel(levelMapping(provider || '', level, configuration).family) })),
  ...(custom ? [{ id: '__custom', label: 'Custom' }] : []),
];
export const concreteModelOptions = (provider: string | undefined, models: Model[]): PickerOption[] =>
  advancedModelChoices(provider, models).map(c => ({ id: c.value, label: c.label }));
export const effortOptions = (provider: string | undefined, model: string, models: Model[]): PickerOption[] =>
  [{ id: 'default', label: 'Default' }, ...effortChoices(provider || '', model, models).map(e => ({ id: e, label: effortLabel(e) }))];

type Choose = (title: string, options: PickerOption[], selected: string) => Promise<string | null>;
/** Difficulty, then (for Custom) Model and Thinking sheets; every step is a tap, never typed. Null when dismissed. */
export async function chooseSelection(choose: Choose, provider: string | undefined, models: Model[], current: AgentSelection, configuration: ModelConfiguration = {}, startCustom = false): Promise<{ model: string; effort: string; speed?: string } | null> {
  const currentLevel = selectionLevel(current.model);
  const picked = startCustom ? '__custom' : await choose('Difficulty', modelOptions(provider, models, configuration), currentLevel === 'custom' ? '__custom' : `freddai-level:${currentLevel}`);
  if (picked === null) return null;
  if (picked !== '__custom') return { model: picked, effort: 'default', speed: undefined };
  const model = await choose('Model', concreteModelOptions(provider, models), currentLevel === 'custom' ? current.model : '');
  if (model === null) return null;
  let effort = 'default';
  const efforts = effortOptions(provider, model, models);
  if (efforts.length > 1) {
    const chosen = await choose('Thinking', efforts, model === current.model ? current.effort : 'default');
    if (chosen === null) return null;
    effort = chosen;
  }
  const speeds = speedChoices(provider || '', model, models);
  if (!speeds.length) return { model, effort, speed: undefined };
  const speed = await choose('Speed', [{ id: 'standard', label: 'Standard' }, ...speeds.map(s => ({ id: s.value, label: s.label, detail: s.description }))], model === current.model && current.speed === 'fast' ? 'fast' : 'standard');
  return speed === null ? null : { model, effort, speed: speed === 'fast' ? 'fast' : undefined };
}
export const PERMISSION_OPTIONS: PickerOption[] = [{ id: 'ask', label: 'Ask for approval' }, { id: 'bypass', label: 'Full access' }];
export const permissionLabel = (mode: PermissionMode) => (mode === 'bypass' ? 'Full access' : 'Ask for approval');
export const supportsPermissions = (provider?: string) => provider === 'codex' || provider === 'claude';

/** Presets show their level; a concrete model shows "Model · Effort". */
export function modelPillLabel(provider: string | undefined, selection: AgentSelection, models: Model[]): string {
  if (selectionLevel(selection.model) !== 'custom') return levelName(selection.model);
  const name = advancedModelChoices(provider, models).find(c => c.value === selection.model)?.label ?? selection.model;
  return `${name} · ${selection.effort && selection.effort !== 'default' ? effortLabel(selection.effort) : 'Default'}${selection.speed === 'fast' ? ' · Fast' : ''}`;
}

/** Client-side mirror of the native limits so the web layer never uploads what the native alert would have refused. */
export const MAX_FILES = 20, MAX_FILE_BYTES = 25 * 1024 * 1024, MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export function attachmentLimitError(files: Pick<NativeFile, 'bytes'>[]): string {
  return files.length > MAX_FILES || files.some(f => f.bytes > MAX_FILE_BYTES) || files.reduce((sum, f) => sum + f.bytes, 0) > MAX_TOTAL_BYTES
    ? 'Attach at most 20 files, 25 MB per file and 100 MB per message.' : '';
}

/** Native shells navigate children in the same modal, returning only a completed pair. */
export async function chooseAssistantSettings(choose: (title: string, options: PickerOption[], selected: string) => Promise<string | null>, assistants: NonNullable<CompanionProject['assistants']>, current: string, defaults = false, configuration: ModelConfiguration = {}): Promise<{ agent: string; model: string } | null> {
  const options: PickerOption[] = [...assistants].sort((a, b) => a.provider.localeCompare(b.provider) || assistantLabel(a).localeCompare(assistantLabel(b))).map(a => ({ id: a.id, label: assistantLabel(a), group: providerName(a.provider), color: a.color || assistantColor(a.provider) }));
  if (defaults) options.unshift({ id: '', label: 'Project defaults' });
  for (const option of options) option.children = modelOptions(assistants.find(a => a.id === option.id)?.provider, [], configuration, ['claude', 'codex'].includes(assistants.find(a => a.id === option.id)?.provider ?? '')).map(m => ({ ...m, id: JSON.stringify({ agent: option.id, model: m.id }) }));
  const picked = await choose('Choose assistant', options, current);
  if (picked === null) return null;
  try { const value = JSON.parse(picked); return typeof value.agent === 'string' && typeof value.model === 'string' ? value : null; } catch { return null; }
}
