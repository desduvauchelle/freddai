import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Send, X } from 'lucide-react';
import { Dormouse } from '../../desktop/Dormouse';
import { MASCOT_PRIORITY } from '../../desktop/mascot-state';
import { DashboardMic } from '../DashboardMic';
import type { CommanderStatus } from '../../desktop/commander/api';
import type { CompanionClient } from '../companion';
import '../../desktop/commander/commander.css';
import './commander-mobile.css';

export const statusText = (s: CommanderStatus) => `${s.needs_you} needs you · ${s.running} running · ${s.done_today} done`;

/** Dashboard presence: avatar circle, mic circle (bottom-left), plus circle (bottom-right) and the Needs you / Running / Done pill. */
export function CommanderCluster({ client, name, status, error, connected, onOpen, onSend }: {
  client: CompanionClient; name: string; status: CommanderStatus | null; error?: string; connected: boolean;
  onOpen: () => void; onSend: (text: string) => Promise<void>;
}) {
  const [composer, setComposer] = useState(false), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [sendError, setSendError] = useState(''), [sent, setSent] = useState('');
  const box = useRef<HTMLTextAreaElement>(null), plus = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (composer) box.current?.focus(); }, [composer]);
  useEffect(() => { if (!sent) return; const t = setTimeout(() => setSent(''), 4000); return () => clearTimeout(t); }, [sent]);
  const shown = status ?? { needs_you: 0, running: 0, done_today: 0 };
  const working = shown.running > 0;
  async function deliver(message: string) {
    setBusy(true); setSendError('');
    try { await onSend(message); setSent(`Sent to ${name}`); return true; }
    catch (e) { setSendError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (await deliver(text.trim())) { setText(''); setComposer(false); plus.current?.focus(); }
  }
  return <section className="commander-cluster companion-commander" aria-label={`${name} cluster`} data-working={working}>
    <div className="commander-circles">
      <div className="commander-avatar-circle" data-state={working ? 'working' : 'ready'}>
        <span className="commander-avatar-art" aria-hidden="true">
          <Dormouse size={108} priority={MASCOT_PRIORITY.hero} mood={working ? 2 : shown.needs_you ? 4 : 0} label={working ? 'Working' : 'Ready'} pauseControl={false} antics />
        </span>
        <button type="button" className="commander-avatar-open" aria-label={`Open ${name}`} onClick={onOpen} />
      </div>
      <div className="commander-circle commander-mic companion-commander-mic" data-pos="left">
        <DashboardMic client={client} project={name} disabled={!connected || busy} onText={t => void deliver(t)} />
      </div>
      <button ref={plus} type="button" className="commander-circle commander-plus commander-circle-button" data-pos="right" disabled={!connected}
        aria-label={`Message ${name}`} aria-expanded={composer} onClick={() => setComposer(v => !v)}>
        {composer ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
      </button>
    </div>
    <p className="commander-name">{name}</p>
    <button type="button" className="commander-pill" data-needs={shown.needs_you > 0} onClick={onOpen}
      aria-label={`${name} status: ${statusText(shown)}. Open ${name}`}>
      <span data-kind="needs">{shown.needs_you} needs you</span><span data-kind="running">{shown.running} running</span><span data-kind="done">{shown.done_today} done</span>
    </button>
    {busy && !composer && <p className="commander-note" role="status">Sending…</p>}
    {sent && <p className="commander-note" role="status">{sent}</p>}
    {(error || sendError) && <p className="commander-error" role="alert">{sendError || `Couldn't reach ${name}: ${error}`}</p>}
    {composer && <form className="companion-commander-composer" role="group" aria-label={`Message ${name}`} onSubmit={e => void submit(e)}>
      <textarea ref={box} aria-label={`Message to ${name}`} placeholder={`What should ${name} handle?`} rows={3} value={text} disabled={busy} onChange={e => setText(e.target.value)} />
      <button type="submit" className="commander-send" disabled={busy || !text.trim()}><Send size={14} aria-hidden="true" />{busy ? 'Sending…' : 'Send'}</button>
    </form>}
  </section>;
}
