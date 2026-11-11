import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Phone } from 'lucide-react';
import { useVoiceCall, type CallIo, type ThreadView } from './voiceCall';
import { VoiceCallBar } from './VoiceCallBar';
import { CommandCard, type CommandSelection } from './CommandCard';
import { WAKE_WORD, commandCenterReducer, type CommandEffect, type CommandEvent, type CommandState, type CommandDraft, type CommandProject } from './commandCenter';
import { defaultSelection, type AgentSelection } from './agent-selection';
import type { Account, Project } from './types';
import './DashboardCall.css';

export type CommandLaunch = { projectId: string; accountId: string; model: string; effort: string; prompt: string };
export type CommandCenterProps = {
  projects: Project[]; accounts: Account[]; native: boolean; homeAccountId?: string;
  homeSelections: Record<string, AgentSelection>; launch: (args: CommandLaunch) => Promise<void>;
};

export type CommandReviewProps = { draft: CommandDraft; onChangeInstruction: (text: string) => void; onSend: () => void; onDismiss: () => void; error: string; sending: boolean };
export type CompanionCommandCenterProps = {
  projects: CommandProject[];
  renderReview: (props: CommandReviewProps) => ReactNode;
  launchDraft: (draft: CommandDraft) => Promise<void>;
};

/** Serializes dispatch so two utterances cannot create competing Commander threads. */
export function serialDispatch(send: (text: string) => Promise<void>) {
  let tail = Promise.resolve();
  return (text: string) => {
    const next = tail.then(() => send(text));
    tail = next.catch(() => {});
    return next;
  };
}

export function DashboardCall({ visible, enabled, hideLauncher = false, connected = true, io, sendText, purgeVoiceQueue, view, onActive, syncError, commandCenter }: {
  purgeVoiceQueue?: () => Promise<void>;
  commandCenter?: CommandCenterProps | CompanionCommandCenterProps;
  syncError?: string; hideLauncher?: boolean; visible: boolean; enabled: boolean; connected?: boolean; io?: CallIo;
  sendText: (text: string) => Promise<void>; view: ThreadView; onActive?: (active: boolean) => void;
}) {
  const latest = useRef(sendText); latest.current = sendText;
  const dispatch = useMemo(() => serialDispatch(text => latest.current(text)), []);
  const [expanded, setExpanded] = useState(false);
  const cc = useRef(commandCenter); cc.current = commandCenter;
  const stateRef = useRef<CommandState>({ kind: 'idle' });
  const [cmd, setCmd] = useState<CommandState>(stateRef.current);
  const [override, setOverride] = useState<(CommandSelection & { projectId: string }) | null>(null);
  const overrideRef = useRef(override); overrideRef.current = override;
  const [cardError, setCardError] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const speakRef = useRef<(text: string) => void>(() => {});

  const defaultsFor = useCallback((projectId: string): CommandSelection => {
    const c = cc.current;
    if (!c || 'launchDraft' in c) return { accountId: '', model: '', effort: 'default' };
    const project = c?.projects.find(p => p.id === projectId);
    const account = c?.accounts.find(a => a.id === project?.account) ?? c?.accounts.find(a => a.id === c.homeAccountId) ?? c?.accounts[0];
    const picked = (account && c?.homeSelections[account.id]) || defaultSelection;
    return { accountId: account?.id ?? '', model: picked.model, effort: picked.effort };
  }, []);
  const selectionFor = (projectId: string): CommandSelection => overrideRef.current?.projectId === projectId ? overrideRef.current : defaultsFor(projectId);

  const apply = (event: CommandEvent) => {
    const result = commandCenterReducer(stateRef.current, event, cc.current?.projects ?? []);
    const prev = stateRef.current;
    stateRef.current = result.state;
    if (result.state.kind !== 'reviewing' || (prev.kind === 'reviewing' && prev.draft.projectId !== result.state.draft.projectId)) { setOverride(null); }
    if (result.state.kind === 'idle' || result.state.kind !== prev.kind) setCardError('');
    setCmd(result.state);
    result.effects.forEach((effect: CommandEffect) => {
      if (effect.type === 'speak') speakRef.current(effect.text);
      else if (effect.type === 'launch') void launchNow();
    });
  };
  const applyRef = useRef(apply); applyRef.current = apply;

  async function launchNow() {
    const state = stateRef.current;
    const c = cc.current;
    if (state.kind !== 'reviewing' || !c || sendingRef.current) return;
    const { projectId, instruction } = state.draft;
    const sel = selectionFor(projectId);
    const name = c.projects.find(p => p.id === projectId)?.name ?? 'the project';
    if (!instruction.trim() || (!('launchDraft' in c) && !sel.accountId)) { const m = 'Choose an agent and an instruction first.'; setCardError(m); speakRef.current(m); return; }
    sendingRef.current = true; setSending(true); setCardError('');
    try {
      if ('launchDraft' in c) await c.launchDraft({ projectId, instruction: instruction.trim() });
      else await c.launch({ projectId, accountId: sel.accountId, model: sel.model, effort: sel.effort, prompt: instruction.trim() });
      applyRef.current({ type: 'launched' });
      speakRef.current(`Starting in ${name}`);
    } catch (error) {
      const m = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: 'command_center.launch_failed', project: projectId, error: m }));
      setCardError(m); speakRef.current(`Could not start in ${name}. ${m}`);
    } finally { sendingRef.current = false; setSending(false); }
  }

  const call = useVoiceCall({ threadId: 'dashboard-commander-call', enabled: enabled && connected, io,
    prefs: { mode: 'queue', speak: true },
    thread: { isBusy: () => view.busy, stopTurn: async () => {}, sendText: dispatch, purgeVoiceQueue }, view,
    onSegment: commandCenter ? text => { applyRef.current({ type: 'segment', text }); return 'consume'; } : undefined });
  speakRef.current = text => { void call.speak(text); };
  const active = !!call.snapshot?.active;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  useEffect(() => { if (!active && stateRef.current.kind !== 'idle') { stateRef.current = { kind: 'idle' }; setCmd(stateRef.current); setOverride(null); setCardError(''); } }, [active]);
  useEffect(() => { if (!connected && active) call.end(); }, [connected, active]);
  useEffect(() => {
    const start = () => { if (visible && call.canStart) { setExpanded(false); call.start(); } };
    window.addEventListener('freddai:start-dashboard-call', start);
    return () => window.removeEventListener('freddai:start-dashboard-call', start);
  });
  if (!active) return visible && !hideLauncher ? <button type="button" className="dashboard-call-start" disabled={!call.canStart} onClick={() => { setExpanded(false); call.start(); }} title="Talk to Commander about any project"><Phone size={16} />Call Commander</button> : null;
  return <aside className="dashboard-call-island" aria-label="Commander call">
    <button type="button" className="dashboard-call-heading" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><Phone size={14} />Commander · talk about any project<span>{expanded ? 'Less' : 'Details'}</span></button>
    <VoiceCallBar call={call.controller!} snapshot={call.snapshot!} agentBusy={view.busy} onEnd={call.end} compact={!expanded} queueOnly />
    {commandCenter && cmd.kind === 'idle' && <p className="dashboard-call-wake">Listening for "{WAKE_WORD}"</p>}
    {commandCenter && cmd.kind === 'awaitingProject' && <p className="dashboard-call-wake">Which project? Say its name.</p>}
    {commandCenter && cmd.kind === 'reviewing' && ('launchDraft' in commandCenter ? commandCenter.renderReview({ draft: cmd.draft, onChangeInstruction: text => apply({ type: 'edit', text }), onSend: () => void launchNow(), onDismiss: () => apply({ type: 'dismiss' }), error: cardError, sending }) : <CommandCard draft={cmd.draft} projects={commandCenter.projects} accounts={commandCenter.accounts} native={commandCenter.native}
      selection={selectionFor(cmd.draft.projectId)} onChangeSelection={sel => setOverride({ ...sel, projectId: cmd.draft.projectId })}
      onChangeInstruction={text => apply({ type: 'edit', text })} onSend={() => void launchNow()} onDismiss={() => apply({ type: 'dismiss' })} error={cardError} sending={sending} />)}
    {syncError && <p role="alert" className="dashboard-call-help">{syncError}</p>}
    {expanded && <p className="dashboard-call-help">Say "Freddie", name a project and describe the task. Review the card, then press Send or say "go"; your existing approval settings still apply. Keep Freddai open during the call.</p>}
  </aside>;
}
