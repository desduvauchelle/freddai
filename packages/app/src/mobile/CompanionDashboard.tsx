import { companionStatusRead } from "./companion";
import { useCallback, useState } from 'react';
import { Office } from '../office/index';
import { DaySummaries } from '../desktop/DaySummaries';
import { AgentControls } from '../desktop/AgentControls';
import { defaultSelection, type AgentSelection } from '../desktop/agent-selection';
import { DashboardMic } from './DashboardMic';
import type { CompanionClient, CompanionProject, CompanionSnapshot } from './companion';
import { Button } from '@freddai/ui/components/button';
import { compareThreadRecency } from '../desktop/types';
import { assistantLabel } from './native-home';
import { companionThreadFaded, nativeRunState } from './native-threads';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@freddai/ui/components/sheet';

type Props = {
  nativeCards?: boolean;
  nativeContent?: boolean;
  onOfficeExpandedChange?: (expanded: boolean) => void;
  read?: Record<string, number>;
  client?: CompanionClient; onDictation?: (project: string, text: string, assistant?: string) => void;
  snapshot: CompanionSnapshot; connected: boolean; onOpen: (id: string) => void;
  onNew: (project: string, assistant?: string) => void; now?: number;
  globalAssistant?: string; onGlobalAssistantChange?: (assistant: string) => void;
  assistantSelections?: Record<string, string>;
  onAssistantChange?: (project: string, assistant: string) => void;
  controls?: Record<string, { selection: AgentSelection }>;
  onSelectionChange?: (key: string, selection: AgentSelection) => void;
};

function ProjectCard({ project, snapshot, now, onProject, ...props }: Props & { project: CompanionProject; now: number; onProject: () => void }) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const threads = snapshot.threads.filter(t => t.project === project.id);
  const working = threads.filter(t => nativeRunState(t) === 'running').length;
  const needs = threads.filter(t => nativeRunState(t) === 'waiting').length;
  const done = threads.filter(t => t.status === 'done' && !t.pending && t.updated >= midnight.getTime()).length;
  const failed = threads.filter(t => nativeRunState(t) === 'failed' && t.updated >= midnight.getTime()).length;
  return <article className="companion-project-card" aria-label={`Project ${project.name}`}>
    <button className="companion-project-open" onClick={onProject} aria-label={`Open project ${project.name}`}>
      <span className="companion-state" style={{ background: project.color }} /><h3>{project.name}</h3>
      <p>{working} working · {needs} need you · {done} done today · {failed} failed today</p>
    </button>
    <ProjectActions {...props} project={project} snapshot={snapshot} />
  </article>;
}

function ProjectActions({ project, connected, client, onNew, onDictation,
  assistantSelections, controls, onSelectionChange }: Props & { project: CompanionProject }) {
  const [localSelections, setLocalSelections] = useState<Record<string, AgentSelection>>({});
  const assistant = project.assistants?.find(a => a.id === assistantSelections?.[project.id])
    ?? project.assistants?.find(a => a.id === project.defaultAssistant) ?? project.assistants?.[0];
  const provider = assistant?.provider ?? project.provider;
  const controlKey = `new:${project.id}:${assistant?.id || ''}:${provider || ''}`;
  const selection = controls?.[controlKey]?.selection ?? localSelections[controlKey] ?? defaultSelection;
  const loadModels = useCallback(() => client!.models!({ project: project.id, assistant: assistant?.id }), [client, project.id, assistant?.id]);
  const disabled = !connected || !project.canStart || (!!project.assistants && !assistant);
  return <div className="companion-project-actions">
    <Button disabled={disabled} onClick={() => onNew(project.id, assistant?.id)} aria-label={`New thread in ${project.name}`}>New thread</Button>
    <div className="companion-project-controls">
      {provider && <AgentControls key={controlKey} native={!!client?.models} provider={provider} loadModels={client?.models ? loadModels : undefined} value={selection}
        onChange={value => { setLocalSelections(old => ({ ...old, [controlKey]: value })); onSelectionChange?.(controlKey, value); }} disabled={disabled} context={`New threads in ${project.name}`} />}
      {client && onDictation && <DashboardMic client={client} project={project.name} disabled={disabled} onText={text => onDictation(project.id, text, assistant?.id)} />}
    </div>
  </div>;
}

function ProjectPanel(props: Props & { project: CompanionProject }) {
  const { project, snapshot, onOpen, read = {} } = props;
  const threads = snapshot.threads.filter(t => t.project === project.id).sort(compareThreadRecency);
  return <>
    <ProjectActions {...props} />
    {threads.length ? threads.map(thread => <button key={thread.id} className="companion-row" data-faded={companionThreadFaded(thread, companionStatusRead(snapshot, read))} onClick={() => onOpen(thread.id)}>
      <span><strong>{thread.title}</strong><small>{nativeRunState(thread)}</small></span>
    </button>) : <p>No threads yet.</p>}
  </>;
}

/** Overview uses the same privacy-limited snapshot as the companion's thread menu. */
export function CompanionDashboard(props: Props) {
  const { snapshot, connected, onOpen, client, now = Date.now() } = props;
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [localGlobalAssistant, setLocalGlobalAssistant] = useState('');
  const globalAssistant = props.globalAssistant ?? localGlobalAssistant;
  const assistants = [...new Map(snapshot.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()];
  const selections = Object.fromEntries(snapshot.projects.map(p => [p.id,
    p.assistants?.find(a => a.id === globalAssistant)?.id ?? p.defaultAssistant ?? '']));
  const activeProject = snapshot.projects.find(p => p.id === openProject);
  const attention = snapshot.threads.filter(t => !!t.pending).sort(compareThreadRecency);
  return <div className="companion-dashboard" data-native-content={props.nativeContent || undefined}>
    <Office variant="mini" onExpand={() => props.onOfficeExpandedChange?.(true)} onClose={() => props.onOfficeExpandedChange?.(false)} now={now} onOpenThread={onOpen}
      projects={snapshot.projects.map(p => ({ ...p, path: '', policy: 'inherit', account: null, last: null }))}
      sessions={snapshot.threads.map(t => ({ ...t, account: '', provider_id: null, pending: t.pending ?? null }))}
      queuedThreadIds={new Set(snapshot.threads.filter(t => t.queued > 0).map(t => t.id))} />
    {!props.nativeCards && <>
    <div className="companion-dashboard-heading"><h2>Your projects</h2>
      {!!assistants.length && <label className="companion-project-agent">Coding agent
        <select aria-label="Coding agent" value={globalAssistant} disabled={!connected} onChange={e => {
          const value = e.target.value; setLocalGlobalAssistant(value); props.onGlobalAssistantChange?.(value);
          for (const project of snapshot.projects) {
            const assistant = project.assistants?.find(a => a.id === value);
            props.onAssistantChange?.(project.id, assistant?.id ?? project.defaultAssistant ?? project.assistants?.[0]?.id ?? '');
          }
        }}><option value="">Project defaults</option>{assistants.map(a => <option key={a.id} value={a.id}>{assistantLabel(a)}</option>)}</select>
      </label>}
    </div>
    {!connected && <p>Connect to your Mac to refresh project activity.</p>}
    {!!attention.length && <section aria-label="Needs you"><h3>Needs you · {attention.length}</h3>
      {attention.map(t => <button key={t.id} className="companion-row" onClick={() => onOpen(t.id)}><span><strong>{t.title}</strong><small>{snapshot.projects.find(p => p.id === t.project)?.name} · Review decision</small></span></button>)}
    </section>}
    <div className="companion-project-grid">{snapshot.projects.map(project => <ProjectCard key={project.id} {...props} assistantSelections={selections} project={project} now={now} onProject={() => setOpenProject(project.id)} />)}</div>
    <Sheet open={!!activeProject} onOpenChange={open => { if (!open) setOpenProject(null); }}>
      <SheetContent className="companion-project-panel">
        <SheetHeader><SheetTitle>{activeProject?.name}</SheetTitle><SheetDescription>Project threads and new tasks</SheetDescription></SheetHeader>
        {activeProject && <ProjectPanel {...props} assistantSelections={selections} project={activeProject}
          onOpen={id => { setOpenProject(null); onOpen(id); }} onNew={(id, assistant) => { setOpenProject(null); props.onNew(id, assistant); }} />}
      </SheetContent>
    </Sheet>
    </>}
    {!props.nativeContent && client?.summaries && connected && <section aria-label="Daily summaries"><h2>Daily summaries</h2><DaySummaries client={client.summaries} /></section>}
    {!props.nativeCards && !snapshot.projects.length && <p>Your projects will appear when your Mac is connected.</p>}
  </div>;
}
