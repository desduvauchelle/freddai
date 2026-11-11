import { levelChoices, levelName, selectionLevel } from "../desktop/model-levels";
import { agentDisplayName, type PermissionMode } from '../desktop/types';
import { advancedModelChoices, effortChoices, effortLabel, modelChoices, type AgentSelection, type Model } from '../desktop/agent-selection';
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
    const next = Object.fromEntries(Object.entries(controls).filter(([k]) => k.startsWith('new:')).map(([k, v]) => [k, { model: v.selection.model, effort: v.selection.effort }]));
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

export const modelOptions = (provider: string | undefined, _models: Model[]): PickerOption[] =>
  [...levelChoices(provider).map(c => ({ id: c.value, label: c.label })), { id: '__custom', label: 'Custom' }];

export async function chooseModel(choose: (title: string, options: PickerOption[], selected: string) => Promise<string | null>, provider: string | undefined, models: Model[], current: string, editCustom?: (current: string) => Promise<string | null>): Promise<string | null> {
  const currentLevel = selectionLevel(current);
  const selected = await choose('Difficulty', modelOptions(provider, models), currentLevel === 'custom' ? '__custom' : `freddai-level:${currentLevel}`);
  if (selected !== '__custom') return selected;
  const choices = advancedModelChoices(provider, models).map(c => ({ id: c.value, label: c.label }));
  if (currentLevel === 'custom' && !choices.some(c => c.id === current)) choices.unshift({ id: current, label: current });
  const model = await choose('Specific model', [...choices, { id: '__custom_id', label: 'Enter model ID…' }], currentLevel === 'custom' ? current : '');
  return model === '__custom_id' ? editCustom ? editCustom(currentLevel === 'custom' ? current : '') : null : model;
}
export const effortOptions = (provider: string | undefined, model: string, models: Model[]): PickerOption[] =>
  [{ id: 'default', label: 'Provider default' }, ...effortChoices(provider || '', model, models).map(e => ({ id: e, label: effortLabel(e) }))];
export const PERMISSION_OPTIONS: PickerOption[] = [{ id: 'ask', label: 'Ask for approval' }, { id: 'bypass', label: 'Full access' }];
export const permissionLabel = (mode: PermissionMode) => (mode === 'bypass' ? 'Full access' : 'Ask for approval');
export const supportsPermissions = (provider?: string) => provider === 'codex' || provider === 'claude';

/** Every composer displays a level; exact legacy model IDs are Custom. */
export function modelPillLabel(provider: string | undefined, selection: AgentSelection, models: Model[]): string {
  return levelName(selection.model);
}

/** Client-side mirror of the native limits so the web layer never uploads what the native alert would have refused. */
export const MAX_FILES = 20, MAX_FILE_BYTES = 25 * 1024 * 1024, MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export function attachmentLimitError(files: Pick<NativeFile, 'bytes'>[]): string {
  return files.length > MAX_FILES || files.some(f => f.bytes > MAX_FILE_BYTES) || files.reduce((sum, f) => sum + f.bytes, 0) > MAX_TOTAL_BYTES
    ? 'Attach at most 20 files, 25 MB per file and 100 MB per message.' : '';
}
