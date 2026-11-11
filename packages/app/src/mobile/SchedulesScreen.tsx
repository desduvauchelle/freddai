import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { ScheduleForm } from '../desktop/ScheduleForm';
import type { ScheduleCommand } from '../desktop/ScheduleManager';
import { cadenceSummary, lastRunSummary, nextRunLabel, scheduleStatus, type ScheduleStatus } from '../desktop/schedule-status';
import { runLimitReached } from '../desktop/schedule-end';
import type { Schedule } from '../desktop/types';

type Named = { id: string; name: string };
type Props = {
  schedules: Schedule[]; projects: Named[]; accounts: { id: string; name: string; provider: string }[];
  connected: boolean; command: ScheduleCommand | undefined; onRefresh: () => void | Promise<void>;
  onOpenThread: (threadId: string) => void; onBack: () => void; desktop?: boolean; defaultAccount?: string;
};
const GROUPS: { status: ScheduleStatus; title: string }[] = [{ status: 'active', title: 'Active' }, { status: 'paused', title: 'Paused' }, { status: 'ended', title: 'Ended' }];
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export function SchedulesScreen({ schedules, projects, accounts, connected, command, onRefresh, onOpenThread, onBack, desktop, defaultAccount }: Props) {
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [busy, setBusy] = useState(''), [confirming, setConfirming] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false), [formError, setFormError] = useState('');
  const writable = connected && !!command;
  const setError = (id: string, message: string) => setErrors(old => { const next = { ...old }; if (message) next[id] = message; else delete next[id]; return next; });

  async function act(id: string, action: 'pause' | 'resume' | 'run' | 'delete') {
    if (!command || busy) return;
    setBusy(id); setError(id, '');
    try {
      await command('schedule_action', { schedule: id, action });
      setConfirming('');
      await onRefresh();
    } catch (e) { setError(id, errorText(e)); }
    finally { setBusy(''); }
  }
  async function save(schedule: Schedule) {
    if (!command || saving) return;
    setSaving(true); setFormError('');
    try { await command('save_schedule', { schedule }); await onRefresh(); setEditing(null); }
    catch (e) { setFormError(errorText(e)); }
    finally { setSaving(false); }
  }
  const projectName = (id: string) => projects.find(p => p.id === id)?.name || id;
  const close = () => { setEditing(null); setFormError(''); };

  if (editing) return <section className="companion-schedules-screen" data-desktop={desktop || undefined} aria-label={editing === 'new' ? 'New scheduled task' : 'Edit scheduled task'}>
    <header className="companion-schedules-header">
      <Button variant="ghost" size="icon" aria-label="Back to scheduled tasks" onClick={close}><ArrowLeft /></Button>
      <h1>{editing === 'new' ? 'New scheduled task' : 'Edit scheduled task'}</h1>
    </header>
    <div className="companion-schedules-body">
      <ScheduleForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} projects={projects} accounts={accounts} defaultAccount={defaultAccount}
        busy={saving} disabled={!writable} error={formError} onSave={save} onCancel={close} />
    </div>
  </section>;

  return <section className="companion-schedules-screen" data-desktop={desktop || undefined} aria-label="Scheduled tasks">
    <header className="companion-schedules-header">
      <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft /></Button>
      <h1>Scheduled tasks</h1>
      <Button variant="outline" disabled={!writable || !projects.length || !accounts.length} onClick={() => setEditing('new')}><Plus size={16} />New</Button>
    </header>
    <div className="companion-schedules-body">
      {!writable && <p className="companion-schedules-notice" role="status">Your Mac is offline. Scheduled tasks are read-only until it reconnects.</p>}
      {!schedules.length && <div className="companion-schedules-empty">
        <p>No scheduled tasks yet. Recurring work runs on your Mac while it is awake.</p>
        <Button disabled={!writable || !projects.length || !accounts.length} onClick={() => setEditing('new')}>New scheduled task</Button>
      </div>}
      {GROUPS.map(({ status, title }) => {
        const items = schedules.filter(s => scheduleStatus(s) === status);
        if (!items.length) return null;
        return <section key={status} className="companion-schedules-group" aria-label={title}>
          <h2>{title} <span>{items.length}</span></h2>
          {items.map(s => {
            const next = status === 'active' ? nextRunLabel(s) : null, last = lastRunSummary(s), working = busy === s.id;
            return <article className="companion-schedule-card" key={s.id} data-status={status} aria-label={s.name}>
              <strong>{s.name}</strong>
              <small>{projectName(s.project)} · {cadenceSummary(s.cron)}</small>
              {next && <p>Next run {next}</p>}
              {last && <p>Last run: {last.state} {last.session
                ? <button type="button" className="companion-schedule-link" onClick={() => onOpenThread(last.session!)}>{last.when}</button>
                : last.when}</p>}
              {errors[s.id] && <p role="alert" className="companion-schedule-error">{errors[s.id]}</p>}
              <div className="companion-schedule-actions">
                {confirming === s.id ? <>
                  <Button variant="destructive" disabled={working || !writable} onClick={() => void act(s.id, 'delete')}>Delete?</Button>
                  <Button variant="ghost" disabled={working} onClick={() => setConfirming('')}>Cancel</Button>
                </> : <>
                  <Button variant="outline" disabled={working || !writable || status === 'ended'} onClick={() => void act(s.id, s.enabled ? 'pause' : 'resume')}>{s.enabled ? 'Pause' : 'Resume'}</Button>
                  <Button variant="outline" disabled={working || !writable || runLimitReached(s)} onClick={() => void act(s.id, 'run')}>Run now</Button>
                  <Button variant="outline" disabled={working || !writable} onClick={() => { setFormError(''); setEditing(s); }}>Edit</Button>
                  <Button variant="ghost" disabled={working || !writable} onClick={() => setConfirming(s.id)}>Delete</Button>
                </>}
              </div>
            </article>;
          })}
        </section>;
      })}
    </div>
  </section>;
}
