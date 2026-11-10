import { useEffect, useMemo, useRef, useState } from 'react';
import { Phone } from 'lucide-react';
import { useVoiceCall, type CallIo, type ThreadView } from './voiceCall';
import { VoiceCallBar } from './VoiceCallBar';
import './DashboardCall.css';

/** Serializes dispatch so two utterances cannot create competing Commander threads. */
export function serialDispatch(send: (text: string) => Promise<void>) {
  let tail = Promise.resolve();
  return (text: string) => {
    const next = tail.then(() => send(text));
    tail = next.catch(() => {});
    return next;
  };
}

export function DashboardCall({ visible, enabled, hideLauncher = false, connected = true, io, sendText, view, onActive, syncError }: {
  syncError?: string; hideLauncher?: boolean; visible: boolean; enabled: boolean; connected?: boolean; io?: CallIo;
  sendText: (text: string) => Promise<void>; view: ThreadView; onActive?: (active: boolean) => void;
}) {
  const latest = useRef(sendText); latest.current = sendText;
  const dispatch = useMemo(() => serialDispatch(text => latest.current(text)), []);
  const [expanded, setExpanded] = useState(false);
  const call = useVoiceCall({ threadId: 'dashboard-commander-call', enabled: enabled && connected, io,
    prefs: { mode: 'queue', speak: true },
    thread: { isBusy: () => view.busy, stopTurn: async () => {}, sendText: dispatch }, view });
  const active = !!call.snapshot?.active;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
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
    {syncError && <p role="alert" className="dashboard-call-help">{syncError}</p>}
    {expanded && <p className="dashboard-call-help">Name a project and describe the task. Requests go to Commander in order; your existing approval settings still apply. Keep Freddai open during the call.</p>}
  </aside>;
}
