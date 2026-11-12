import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { useVoiceCall, type CallIo, type ThreadView } from './voiceCall';
import { callPhase, type CallPhase } from './VoiceCallBar';
import { CommandCard, type CommandSelection } from './CommandCard';
import { WAKE_WORD, commandCenterReducer, type CommandEffect, type CommandEvent, type CommandState, type CommandDraft, type CommandProject } from './commandCenter';
import { defaultSelection, type AgentSelection } from './agent-selection';
import type { Account, Project } from './types';
import './DashboardCall.css';

/** What the native shell header needs to draw the call indicator. */
export type DashboardCallState = { active: boolean; startedAt: number | null; muted: boolean; phase: CallPhase | 'idle' };
export const IDLE_CALL_STATE: DashboardCallState = { active: false, startedAt: null, muted: false, phase: 'idle' };
export const END_CALL_EVENT = 'freddai:end-dashboard-call';
export const TOGGLE_MUTE_EVENT = 'freddai:toggle-dashboard-call-mute';
export const DISMISS_REVIEW_EVENT = 'freddai:dismiss-dashboard-review';
const PHASE_LABELS: Record<CallPhase, string> = { starting: 'Starting call', listening: 'Listening', hearing: 'Hearing you', transcribing: 'Transcribing', working: 'Agent working', speaking: 'Speaking', paused: 'Paused', error: 'Error' };

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type CommandLaunch = { projectId: string; accountId: string; model: string; effort: string; speed?: string; prompt: string };
export type CommandCenterProps = {
  projects: Project[]; accounts: Account[]; native: boolean; homeAccountId?: string; modelConfiguration?: import("./model-levels").ModelConfiguration;
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

export function DashboardCall({ visible, enabled, hideLauncher = false, connected = true, io, sendText, purgeVoiceQueue, view, onActive, onCallState, onReview, syncError, commandCenter, projectNameUppercase }: {
  purgeVoiceQueue?: () => Promise<void>;
  projectNameUppercase?: boolean;
  commandCenter?: CommandCenterProps | CompanionCommandCenterProps;
  syncError?: string; hideLauncher?: boolean; visible: boolean; enabled: boolean; connected?: boolean; io?: CallIo;
  sendText: (text: string) => Promise<void>; view: ThreadView; onActive?: (active: boolean) => void;
  /** Fires whenever active/startedAt/muted/phase change (the native header mirrors them). */
  onCallState?: (state: DashboardCallState) => void;
  /** Fires when the review card opens or closes (native presents it in a page sheet). */
  onReview?: (reviewing: boolean) => void;
}) {
  const latest = useRef(sendText); latest.current = sendText;
  const dispatch = useMemo(() => serialDispatch(text => latest.current(text)), []);
  const [now, setNow] = useState(() => Date.now());
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
    return { accountId: account?.id ?? '', model: picked.model, effort: picked.effort, speed: picked.speed };
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
      else await c.launch({ projectId, accountId: sel.accountId, model: sel.model, effort: sel.effort, speed: sel.speed, prompt: instruction.trim() });
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
  const snap = call.snapshot;
  const active = !!snap?.active;
  const phase: CallPhase | 'idle' = snap?.active ? callPhase(snap, view.busy) : 'idle';
  const startedAt = snap?.active ? snap.startedAt : null;
  const muted = !!snap?.active && snap.muted;
  const reviewing = active && cmd.kind === 'reviewing' && !!commandCenter;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  useEffect(() => { onCallState?.(active ? { active, startedAt, muted, phase } : IDLE_CALL_STATE); }, [active, startedAt, muted, phase, onCallState]);
  useEffect(() => { onReview?.(reviewing); }, [reviewing, onReview]);
  useEffect(() => { if (!startedAt) return; setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [startedAt]);
  useEffect(() => { if (!active && stateRef.current.kind !== 'idle') { stateRef.current = { kind: 'idle' }; setCmd(stateRef.current); setOverride(null); setCardError(''); } }, [active]);
  useEffect(() => { if (!connected && active) call.end(); }, [connected, active]);
  useEffect(() => {
    const start = () => { if (visible && call.canStart) call.start(); };
    const end = () => call.end();
    const mute = () => call.controller?.toggleMute();
    const dismiss = () => { if (stateRef.current.kind === 'reviewing' && !sendingRef.current) applyRef.current({ type: 'dismiss' }); };
    window.addEventListener('freddai:start-dashboard-call', start);
    window.addEventListener(END_CALL_EVENT, end);
    window.addEventListener(TOGGLE_MUTE_EVENT, mute);
    window.addEventListener(DISMISS_REVIEW_EVENT, dismiss);
    return () => {
      window.removeEventListener('freddai:start-dashboard-call', start);
      window.removeEventListener(END_CALL_EVENT, end);
      window.removeEventListener(TOGGLE_MUTE_EVENT, mute);
      window.removeEventListener(DISMISS_REVIEW_EVENT, dismiss);
    };
  });
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !sendingRef.current) { e.preventDefault(); applyRef.current({ type: 'dismiss' }); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewing]);
  if (!active || !snap) return visible && !hideLauncher ? <button type="button" className="dashboard-call-start" disabled={!call.canStart} onClick={() => call.start()} title="Talk to Commander about any project"><Phone size={16} />Call Commander</button> : null;

  const wake = commandCenter && (phase === 'listening' || phase === 'starting') ? (cmd.kind === 'awaitingProject' ? 'Which project? Say its name.' : cmd.kind === 'idle' ? `Listening for "${WAKE_WORD}"` : '') : '';
  const label = wake || PHASE_LABELS[phase as CallPhase];
  const error = [snap.error, syncError].filter(Boolean).join(' ');
  const card = reviewing && commandCenter ? ('launchDraft' in commandCenter ? commandCenter.renderReview({ draft: (cmd as Extract<CommandState, { kind: 'reviewing' }>).draft, onChangeInstruction: text => apply({ type: 'edit', text }), onSend: () => void launchNow(), onDismiss: () => apply({ type: 'dismiss' }), error: cardError, sending }) : <CommandCard projectNameUppercase={projectNameUppercase} draft={(cmd as Extract<CommandState, { kind: 'reviewing' }>).draft} projects={commandCenter.projects} accounts={commandCenter.accounts} native={commandCenter.native} modelConfiguration={commandCenter.modelConfiguration}
      selection={selectionFor((cmd as Extract<CommandState, { kind: 'reviewing' }>).draft.projectId)} onChangeSelection={sel => setOverride({ ...sel, projectId: (cmd as Extract<CommandState, { kind: 'reviewing' }>).draft.projectId })}
      onChangeInstruction={text => apply({ type: 'edit', text })} onSend={() => void launchNow()} onDismiss={() => apply({ type: 'dismiss' })} error={cardError} sending={sending} />) : null;
  const placement = hideLauncher ? 'native' : commandCenter && 'launchDraft' in commandCenter ? 'bottom' : 'top-right';
  const errorLine = error && <p role="alert" className="dashboard-call-error"><span>{error}</span>{snap.error && <button type="button" aria-label="Dismiss error" onClick={() => call.controller?.dismissError()}><X size={12} aria-hidden="true" /></button>}</p>;
  return <>
    {hideLauncher ? errorLine && <div className="dashboard-call-error-dock">{errorLine}</div> : <div className="dashboard-call-pill-wrap">
      <aside className="dashboard-call-pill" aria-label="Commander call" data-phase={phase} data-muted={muted || undefined} title={label}>
        <span className="dashboard-call-wave" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="dashboard-call-time" aria-label="Call duration">{formatElapsed(startedAt ? now - startedAt : 0)}</span>
        <span className="dashboard-call-sr" role="status">{label}</span>
        <button type="button" className="dashboard-call-icon" aria-label={snap.muted ? 'Unmute' : 'Mute'} aria-pressed={snap.muted} title={snap.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => call.controller?.toggleMute()}>{snap.muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}</button>
        <button type="button" className="dashboard-call-icon dashboard-call-hangup" aria-label="End call" title="End call" onClick={() => call.end()}><PhoneOff size={14} aria-hidden="true" /></button>
      </aside>
      {errorLine}
    </div>}
    {card && createPortal(<div className="dashboard-review-sheet" data-placement={placement}>{card}</div>, document.body)}
  </>;
}
