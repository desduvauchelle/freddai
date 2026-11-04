import { providerName, type PermissionMode } from '../desktop/types';
import { effortChoices, effortLabel, modelChoices, type AgentSelection, type Model } from '../desktop/agent-selection';
import type { CompanionProject } from './companion';
import type { NativeFile, PickerOption } from './native-shell';

/** Pure helpers behind the iPhone "new thread" home and the agent/model pills. */

const LAST_PROJECT_KEY = 'freddai.companion.lastProject';
export const savedLastProject = (): string => { try { return localStorage.getItem(LAST_PROJECT_KEY) || ''; } catch { return ''; } };
export const saveLastProject = (id: string) => { try { if (id) localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* Last-used project is a convenience only. */ } };

/** First of the preferred project ids that can start threads, else the first startable project. */
export function pickNewProject(projects: CompanionProject[], ...preferred: string[]): string {
  return preferred.find(id => !!id && projects.some(p => p.id === id && p.canStart)) ?? projects.find(p => p.canStart)?.id ?? '';
}

export const assistantLabel = (assistant: { name: string; provider: string }) => `${providerName(assistant.provider)} · ${assistant.name}`;
export const projectOptions = (projects: CompanionProject[]): PickerOption[] =>
  projects.map(p => ({ id: p.id, label: p.name, detail: p.canStart ? undefined : 'Not ready on your Mac', disabled: !p.canStart }));
export const assistantOptions = (project?: CompanionProject): PickerOption[] =>
  (project?.assistants ?? []).map(a => ({ id: a.id, label: assistantLabel(a) }));

const DEFAULT_OPTION: PickerOption = { id: '', label: 'Agent default' };
export const modelOptions = (provider: string | undefined, models: Model[]): PickerOption[] =>
  [DEFAULT_OPTION, ...modelChoices(provider, models).map(c => ({ id: c.value, label: c.label }))];
export const effortOptions = (provider: string | undefined, model: string, models: Model[]): PickerOption[] =>
  [{ id: 'default', label: 'Agent default' }, ...effortChoices(provider || '', model, models).map(e => ({ id: e, label: effortLabel(e) }))];
export const PERMISSION_OPTIONS: PickerOption[] = [{ id: 'ask', label: 'Ask for approval' }, { id: 'bypass', label: 'Full access' }];
export const permissionLabel = (mode: PermissionMode) => (mode === 'bypass' ? 'Full access' : 'Ask for approval');
export const supportsPermissions = (provider?: string) => provider === 'codex' || provider === 'claude';

/** "Opus · High", or "Model default" when nothing is chosen. */
export function modelPillLabel(provider: string | undefined, selection: AgentSelection, models: Model[]): string {
  const name = modelChoices(provider, models).find(c => c.value === selection.model)?.label || selection.model || 'Model default';
  return selection.effort !== 'default' ? `${name} · ${effortLabel(selection.effort)}` : name;
}

/** Client-side mirror of the native limits so the web layer never uploads what the native alert would have refused. */
export const MAX_FILES = 20, MAX_FILE_BYTES = 25 * 1024 * 1024, MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export function attachmentLimitError(files: Pick<NativeFile, 'bytes'>[]): string {
  return files.length > MAX_FILES || files.some(f => f.bytes > MAX_FILE_BYTES) || files.reduce((sum, f) => sum + f.bytes, 0) > MAX_TOTAL_BYTES
    ? 'Attach at most 20 files, 25 MB per file and 100 MB per message.' : '';
}
