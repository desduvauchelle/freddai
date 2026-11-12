import { compareThreadRecency } from '../desktop/types';
import { dashboardProjectGroups } from './dashboard-projects';
import type { CompanionProject, CompanionSnapshot } from './companion';
import { effortLabel, defaultSelection, type AgentSelection } from '../desktop/agent-selection';
import { assistantLabel, lastAssistantFor, modelPillLabel } from './native-home';
import type { Outgoing } from './outbox';
import { companionStatusRead } from './companion';
import { formatProjectName } from '../projectName';
import { nativeThread, nativeRunState, pendingThreads } from './native-threads';

/** Resolution order: explicit selection, then the agent last used for this project, then the project default, then the first one. */
export function dashboardAssistantFor(project: CompanionProject, selected: string) {
  const last = lastAssistantFor(project);
  return project.assistants?.find(a => a.id === selected)
    ?? project.assistants?.find(a => a.id === last)
    ?? project.assistants?.find(a => a.id === project.defaultAssistant) ?? project.assistants?.[0];
}
export function dashboardControlKey(project: CompanionProject, selected: string) {
  const assistant = dashboardAssistantFor(project, selected);
  return `new:${project.id}:${assistant?.id || ''}:${assistant?.provider || project.provider || ''}`;
}
/** The Commander cluster for the native dashboard. Counts come from the snapshot (threads Commander started are not linkable there), so MobileApp overrides these with the Mac's commander_state when it has it. */
function commanderModel(snapshot: CompanionSnapshot) {
  const project = snapshot.projects.find(p => p.kind === 'commander');
  if (!project) return null;
  const threads = snapshot.threads.filter(t => t.project === project.id);
  return { sending: false, id: project.id, name: project.name, needsYou: threads.filter(t => nativeRunState(t) === 'waiting').length, running: threads.filter(t => nativeRunState(t) === 'running').length, doneToday: 0 };
}
function needsYouThreads(snapshot: CompanionSnapshot, read: Record<string, number>) {
  const projects = new Map(snapshot.projects.filter(p => p.kind !== 'commander').map(p => [p.id, p]));
  return snapshot.threads
    .filter(t => projects.has(t.project) && !['archived', 'deleted'].includes(t.status) && nativeRunState(t) === 'waiting')
    .sort(compareThreadRecency)
    .map(t => ({ ...nativeThread(t, companionStatusRead(snapshot, read)), project: t.project, projectName: formatProjectName(projects.get(t.project)!.name, snapshot.threadList?.projectNameUppercase) }));
}
export function buildDashboardModel(snapshot: CompanionSnapshot, connected: boolean, selected: string,
  controls: Record<string, { selection: AgentSelection }>, busy: boolean, now = Date.now(), expanded = false, read: Record<string, number> = {}, outbox: Outgoing[] = []) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const controlProject = snapshot.projects.find(p => p.kind !== 'commander' && (!selected || p.assistants?.some(a => a.id === selected)));
  const controlAssistant = controlProject ? dashboardAssistantFor(controlProject, selected) : undefined;
  const selection = controlProject ? controls[dashboardControlKey(controlProject, selected)]?.selection ?? defaultSelection : defaultSelection;
  const provider = controlAssistant?.provider ?? controlProject?.provider;
  return {
    model: modelPillLabel(provider, { ...selection, effort: 'default', speed: undefined }, []),
    difficulty: modelPillLabel(provider, selection, []),
    hasControls: !!provider,
    workspace: null as string | null, summaries: [] as NativeSummary[], schedules: false, message: '',
    connected, busy, expanded, workspaceHeight: 240, agent: controlAssistant ? assistantLabel(controlAssistant) : 'Choose provider',
    commander: commanderModel(snapshot),
    /** Waiting threads across all non-commander projects, newest first; rendered under the commander cluster and hidden when empty. */
    needsYou: needsYouThreads(snapshot, read),
    projectGroups: dashboardProjectGroups(snapshot).map(group => ({ ...group, projects: group.projects.map(project => project.id) })),
    projects: snapshot.projects.filter(p => p.kind !== 'commander').map(project => {
      const assistant = dashboardAssistantFor(project, selected), provider = assistant?.provider || project.provider;
      const threads = snapshot.threads.filter(t => t.project === project.id);
      const working = threads.filter(t => nativeRunState(t) === 'running').length;
      const needs = threads.filter(t => nativeRunState(t) === 'waiting').length;
      const done = threads.filter(t => t.status === 'done' && !t.pending && t.updated >= midnight.getTime()).length;
      const failed = threads.filter(t => nativeRunState(t) === 'failed' && t.updated >= midnight.getTime()).length;
      const ids = new Set(snapshot.threads.map(t => t.id));
      const pending = pendingThreads(project.id, outbox, ids, connected, now);
      return { id: project.id, name: formatProjectName(project.name, snapshot.threadList?.projectNameUppercase), color: project.color, assistant: assistant?.id || '',
        canStart: connected && !busy && project.canStart && (!project.assistants || !!assistant),
        activity: `${working} working · ${needs} need you · ${done} done today · ${failed} failed today`,
        recent: [...pending, ...[...threads].filter(t => !['archived', 'deleted'].includes(t.status)).sort(compareThreadRecency).map(t => nativeThread(t, companionStatusRead(snapshot, read)))].slice(0, 3),
        model: provider ? modelPillLabel(provider, controls[dashboardControlKey(project, selected)]?.selection ?? defaultSelection, []) : '',
      };
    }),
  };
}
export type NativeDashboardModel = ReturnType<typeof buildDashboardModel>;
export type DashboardAction = { action: string; project?: string; assistant?: string; path?: string; send?: boolean; thread?: string };

export type NativeSummary = { date: string; label: string; text: string; action: string | null; busy: boolean };
