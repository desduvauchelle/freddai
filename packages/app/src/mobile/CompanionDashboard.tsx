import { ProjectTile } from "../desktop/ProjectTile";
import { dashboardAssistantFor, dashboardControlKey } from './native-dashboard';
import { DashboardSelect } from "../desktop/DashboardSelect";
import { dashboardProjectGroups } from './dashboard-projects';
import { companionStatusRead } from "./companion";
import { useCallback, useEffect, useRef, useState } from 'react';
import { OfficeOrder } from '../office/OfficeOrder';
import { Office } from '../office/index';
import { DaySummaries } from '../desktop/DaySummaries';
import { AgentControls } from '../desktop/AgentControls';
import { defaultSelection, type AgentSelection } from '../desktop/agent-selection';
import { DashboardMic } from './DashboardMic';
import { CommanderCluster } from './commander/CommanderCluster';
import { useCommanderData } from './commander/useCommanderData';
import type { CompanionClient, CompanionProject, CompanionSnapshot } from './companion';
import { Button } from '@freddai/ui/components/button';
import { labelStatus } from '../desktop/ThreadStatus';
import { compareThreadRecency, threadListStatus } from '../desktop/types';
import { assistantLabel } from './native-home';
import { companionThreadFaded, nativeRunState } from './native-threads';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@freddai/ui/components/sheet';

type Props = {
  sendingProjects?: string[];
  nativeCards?: boolean;
  nativeContent?: boolean;
  onOfficeHeightChange?: (height: number) => void;
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
  /** Commander-in-Chief: opens its screen, and sends a quick message to it. Both required for the cluster to show. */
  onOpenCommander?: () => void; onSendCommander?: (text: string) => Promise<void>;
};

function ProjectCard({ project, snapshot, now, onProject, ...props }: Props & { project: CompanionProject; now: number; onProject: () => void }) {
  const threads = snapshot.threads.filter(t => t.project === project.id && !['archived', 'deleted'].includes(t.status));
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const counts = {
    working: threads.filter(t => ['starting', 'running'].includes(nativeRunState(t))).length,
    done: threads.filter(t => t.status === 'done' && !t.pending && t.updated >= midnight).length,
    needs: threads.filter(t => nativeRunState(t) === 'waiting').length,
    failed: threads.filter(t => nativeRunState(t) === 'failed' && t.updated >= midnight).length,
  };
  return <ProjectTile openLabel={`Open project ${project.name}`} project={project} hasThreads={threads.length > 0} counts={counts}
    recent={[...threads].sort(compareThreadRecency).slice(0, 3).map(t => ({ id: t.id, title: t.title, status: threadListStatus(t, companionStatusRead(snapshot, props.read ?? {})) }))}
    onOpen={onProject} onOpenThread={props.onOpen}
    actions={<ProjectActions {...props} compact project={project} snapshot={snapshot} />}>
    {props.sendingProjects?.includes(project.id) && <p role="status">Sending message…</p>}
  </ProjectTile>;
}

function ProjectActions({ project, connected, client, onNew, onDictation,
  assistantSelections, controls, onSelectionChange, compact = false }: Props & { project: CompanionProject; compact?: boolean }) {
  const assistant = project.assistants?.find(a => a.id === assistantSelections?.[project.id])
    ?? project.assistants?.find(a => a.id === project.defaultAssistant) ?? project.assistants?.[0];
  const disabled = !connected || !project.canStart || (!!project.assistants && !assistant);
  return <div className="companion-project-actions">
    <Button variant={compact ? "ghost" : "default"} disabled={disabled} onClick={() => onNew(project.id, assistant?.id)} aria-label={`New thread in ${project.name}`}><span aria-hidden={compact || undefined}>{compact ? '+' : 'New thread'}</span></Button>
    <div className="companion-project-controls">
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
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = root.current?.querySelector('.office-mini');
    if (!props.nativeContent || !card || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // A retained dashboard is hidden during the sheet; keep its last visible size.
      const height = Math.ceil(card.getBoundingClientRect().height);
      if (height > 0) props.onOfficeHeightChange?.(height);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [props.nativeContent, props.onOfficeHeightChange]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [localGlobalAssistant, setLocalGlobalAssistant] = useState('');
  const globalAssistant = props.globalAssistant ?? localGlobalAssistant;
  const [globalSelections, setGlobalSelections] = useState<Record<string, AgentSelection>>({});
  const assistants = [...new Map(snapshot.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()];
  const selections = Object.fromEntries(snapshot.projects.map(p => [p.id,
    dashboardAssistantFor(p, globalAssistant)?.id ?? '']));
  const controlProject = snapshot.projects.find(p => p.kind !== 'commander' && (!globalAssistant || p.assistants?.some(a => a.id === globalAssistant)));
  const controlAssistant = controlProject ? dashboardAssistantFor(controlProject, globalAssistant) : undefined;
  const controlProvider = controlAssistant?.provider ?? controlProject?.provider;
  const controlKey = controlProject ? dashboardControlKey(controlProject, globalAssistant) : '';
  const globalSelection = globalSelections[globalAssistant] ?? props.controls?.[controlKey]?.selection ?? defaultSelection;
  const loadDashboardModels = useCallback(() => client!.models!({ project: controlProject!.id, assistant: controlAssistant?.id }), [client, controlProject?.id, controlAssistant?.id]);
  const activeProject = snapshot.projects.find(p => p.id === openProject);
  const attention = snapshot.threads.filter(t => !!t.pending).sort(compareThreadRecency);
  const commanderProject = snapshot.projects.find(p => p.kind === 'commander');
  const showCommander = !props.nativeCards && !!commanderProject && !!client?.commander && !!props.onOpenCommander && !!props.onSendCommander;
  const commander = useCommanderData(client, showCommander && connected);
  return <div ref={root} className="companion-dashboard" data-native-content={props.nativeContent || undefined}>
    {showCommander && <CommanderCluster client={client!} name={commanderProject!.name} status={commander.state?.status ?? null} error={commander.error} connected={connected}
      onOpen={props.onOpenCommander!} onSend={props.onSendCommander!} />}
    <Office proposals={showCommander ? commander.proposals : undefined} onProposalRespond={showCommander && client?.commander ? async (id, approve) => { await client.commander!.respond({ id, approve }); await commander.refresh(); } : undefined} onOpenCommander={props.onOpenCommander} renderTaskControls={client ? (projectId, onListening) => {
      const project = snapshot.projects.find(p => p.id === projectId)!;
      const assistant = project.assistants?.find(a => a.id === selections[projectId]) ?? project.assistants?.[0];
      const controlKey = `new:${projectId}:${assistant?.id || ''}:${assistant?.provider || project.provider || ''}`;
      const selection = props.controls?.[controlKey]?.selection ?? defaultSelection;
      return <OfficeOrder key={projectId} disabled={!connected || !project.canStart || (!!project.assistants && !assistant)}
        onSend={(prompt, requestId) => client.start({ project: projectId, assistant: assistant?.id, prompt, requestId,
          options: { model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, permission_mode: 'bypass', update_agent_controls: true } })}
        renderMic={(onText, disabled) => <DashboardMic client={client} project={project.name} disabled={disabled} onText={onText} onListening={onListening} />} />;
    } : undefined} variant="mini" onExpand={() => props.onOfficeExpandedChange?.(true)} onClose={() => props.onOfficeExpandedChange?.(false)} now={now} onOpenThread={onOpen}
      projects={snapshot.projects.map(p => ({ ...p, path: '', policy: 'inherit', account: null, last: null }))}
      sessions={snapshot.threads.map(t => ({ ...t, account: '', provider_id: null, pending: t.pending ?? null }))}
      schedules={snapshot.schedules}
      queuedThreadIds={new Set(snapshot.threads.filter(t => t.queued > 0).map(t => t.id))} />
    {!props.nativeCards && <>
    <div className="dashboard-project-toolbar">
    <div className="companion-dashboard-heading"><h2>Your projects</h2></div>
    <div className="dashboard-launch-controls" role="group" aria-label="Dashboard task defaults">
      {!!assistants.length && <DashboardSelect label="Coding agent" displayValue={controlAssistant ? assistantLabel(controlAssistant) : 'Choose provider'} value={globalAssistant} disabled={!connected}
        options={[{ value: '', label: 'Project defaults' }, ...assistants.map(a => ({ value: a.id, label: assistantLabel(a) }))]}
        onChange={value => {
          setLocalGlobalAssistant(value); props.onGlobalAssistantChange?.(value);
          for (const project of snapshot.projects) {
            const assistant = project.assistants?.find(a => a.id === value);
            props.onAssistantChange?.(project.id, assistant?.id ?? project.defaultAssistant ?? project.assistants?.[0]?.id ?? '');
          }
        }} />}
      {controlProvider && <AgentControls inline provider={controlProvider} native={!!client?.models} loadModels={client?.models ? loadDashboardModels : undefined}
        value={globalSelection} disabled={!connected} context="all new dashboard tasks" onChange={selection => {
          setGlobalSelections(old => ({ ...old, [globalAssistant]: selection }));
          for (const project of snapshot.projects) {
            const assistant = project.assistants?.find(a => a.id === selections[project.id]);
            if ((assistant?.provider ?? project.provider) === controlProvider) props.onSelectionChange?.(`new:${project.id}:${assistant?.id || ''}:${controlProvider}`, selection);
          }
        }} />}
    </div>
    </div>
    {!connected && <p>Connect to your Mac to refresh project activity.</p>}
    {!!attention.length && <section aria-label="Needs you"><h3>Needs you · {attention.length}</h3>
      {attention.map(t => <button key={t.id} className="companion-row" onClick={() => onOpen(t.id)}><span><strong>{t.title}</strong><small>{snapshot.projects.find(p => p.id === t.project)?.name} · Review decision</small></span></button>)}
    </section>}
    {dashboardProjectGroups(snapshot).map(group => <section key={group.id} aria-label={group.name ?? undefined}>
      {group.name && <h3 className="companion-workspace-heading">{group.name}</h3>}
      <div className="companion-project-grid">{group.projects.map(project => <ProjectCard key={project.id} {...props} assistantSelections={selections} project={project} now={now} onProject={() => setOpenProject(project.id)} />)}</div>
    </section>)}
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
