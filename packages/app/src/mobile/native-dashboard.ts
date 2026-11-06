import type { CompanionProject, CompanionSnapshot } from './companion';
import { defaultSelection, type AgentSelection } from '../desktop/agent-selection';
import { assistantLabel, modelPillLabel } from './native-home';
import { nativeRunState } from './native-threads';

export function dashboardAssistantFor(project: CompanionProject, selected: string) {
  return project.assistants?.find(a => a.id === selected)
    ?? project.assistants?.find(a => a.id === project.defaultAssistant) ?? project.assistants?.[0];
}
export function dashboardControlKey(project: CompanionProject, selected: string) {
  const assistant = dashboardAssistantFor(project, selected);
  return `new:${project.id}:${assistant?.id || ''}:${assistant?.provider || project.provider || ''}`;
}
export function buildDashboardModel(snapshot: CompanionSnapshot, connected: boolean, selected: string,
  controls: Record<string, { selection: AgentSelection }>, busy: boolean, now = Date.now(), expanded = false) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const assistants = [...new Map(snapshot.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()];
  return {
    summaries: [] as NativeSummary[], schedules: false, message: '',
    connected, busy, expanded, agent: assistants.find(a => a.id === selected) ? assistantLabel(assistants.find(a => a.id === selected)!) : 'Project defaults',
    projects: snapshot.projects.map(project => {
      const assistant = dashboardAssistantFor(project, selected), provider = assistant?.provider || project.provider;
      const threads = snapshot.threads.filter(t => t.project === project.id);
      const working = threads.filter(t => nativeRunState(t) === 'running').length;
      const needs = threads.filter(t => nativeRunState(t) === 'waiting').length;
      const done = threads.filter(t => t.status === 'done' && !t.pending && t.updated >= midnight.getTime()).length;
      const failed = threads.filter(t => nativeRunState(t) === 'failed' && t.updated >= midnight.getTime()).length;
      return { id: project.id, name: project.name, color: project.color, assistant: assistant?.id || '',
        canStart: connected && !busy && project.canStart && (!project.assistants || !!assistant),
        activity: `${working} working · ${needs} need you · ${done} done today · ${failed} failed today`,
        model: provider ? modelPillLabel(provider, controls[dashboardControlKey(project, selected)]?.selection ?? defaultSelection, []) : '',
      };
    }),
  };
}
export type NativeDashboardModel = ReturnType<typeof buildDashboardModel>;
export type DashboardAction = { action: string; project?: string; assistant?: string; path?: string };

export type NativeSummary = { date: string; label: string; text: string; action: string | null; busy: boolean };
