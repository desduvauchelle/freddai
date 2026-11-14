import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import {
  bugWalkRecordingAvailable, cancelBugWalkRecording, onBugWalkRecordingState, pickBugWalkVideo, startBugWalkRecording, stopBugWalkRecording,
} from './native-shell';
import {
  deviceLabel, formatBytes, formatElapsed, phaseLabel, POLL_MS, pollingFinished, progressPercent,
  type BugWalkPermission, type BugWalkSplit, type BugWalkStatus, type BugWalkVideo,
} from './bugWalk';
import type { CompanionClient } from './companion';

type Named = { id: string; name: string; kind?: string | null };
type Props = { client: CompanionClient; projects: Named[]; defaultProject?: string; desktop?: boolean; onOpenThread: (threadId: string) => void; onBack: () => void };
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Step 1: record Freddai itself or choose a screen recording from Photos. */
function RecordStep({ onVideo }: { onVideo: (video: BugWalkVideo) => void }) {
  const [available, setAvailable] = useState(false);
  const [microphone, setMicrophone] = useState(true);
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    bugWalkRecordingAvailable().then(v => { if (live) setAvailable(v); }).catch(e => { if (live) setError(errorText(e)); });
    const off = onBugWalkRecordingState(s => { if (!live) return; setState(s.state); setElapsed(s.elapsedS); });
    return () => { live = false; off(); };
  }, []);
  const run = async (action: () => Promise<BugWalkVideo | null | void>) => {
    setError('');
    try { const video = await action(); if (video) onVideo(video); }
    catch (e) { setError(errorText(e)); setState('idle'); }
  };
  const start = () => run(async () => { await startBugWalkRecording({ microphone }); setState('recording'); setElapsed(0); });
  const stop = () => { setState('processing'); return run(() => stopBugWalkRecording()); };
  return <div className="bug-walk-step" aria-label="Record">
    <h2>Record</h2>
    {available && (state === 'idle' ? <>
      <Button onClick={start}>Record Freddai</Button>
      <label className="bug-walk-toggle"><input type="checkbox" checked={microphone} onChange={e => setMicrophone(e.target.checked)} /> Record my voice</label>
    </> : state === 'recording' ? <>
      <p role="timer" aria-label="Recording time">Recording {formatElapsed(elapsed)}</p>
      <Button onClick={stop}>Stop recording</Button>
      <Button variant="ghost" onClick={() => run(async () => { await cancelBugWalkRecording(); setState('idle'); })}>Discard</Button>
    </> : <p role="status">Processing recording…</p>)}
    {state === 'idle' && <Button variant={available ? 'ghost' : 'default'} onClick={() => run(() => pickBugWalkVideo())}>Choose a screen recording</Button>}
    <p className="bug-walk-hint">Recording in Freddai captures only this app. To show a bug in another app, start a screen recording from iOS Control Center, then choose it from Photos here.</p>
    {error && <p className="bug-walk-error" role="alert">{error}</p>}
  </div>;
}

/** Step 2: where the Mac should open the fix thread. */
function SendStep({ video, projects, defaultProject, onSend, onBack }: { video: BugWalkVideo; projects: Named[]; defaultProject?: string; onSend: (project: string, permission: BugWalkPermission, split: BugWalkSplit) => void; onBack: () => void }) {
  const [project, setProject] = useState(defaultProject && projects.some(p => p.id === defaultProject) ? defaultProject : projects[0]?.id ?? '');
  const [permission, setPermission] = useState<BugWalkPermission>('ask');
  const [split, setSplit] = useState<BugWalkSplit>('single');
  return <div className="bug-walk-step" aria-label="Send">
    <h2>Send</h2>
    <p className="bug-walk-hint">{video.name} · {formatElapsed(video.durationS)} · {formatBytes(video.bytes)}</p>
    <label>Project
      <select aria-label="Project" value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </label>
    <div role="group" aria-label="Permissions" className="bug-walk-split">
      {([['ask', 'Ask'], ['bypass', 'Bypass']] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={permission === v} data-active={permission === v} onClick={() => setPermission(v)}>{label}</button>)}
    </div>
    <div role="group" aria-label="Threads" className="bug-walk-split">
      {([['single', 'One thread'], ['per_item', 'One per issue']] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={split === v} data-active={split === v} onClick={() => setSplit(v)}>{label}</button>)}
    </div>
    <Button disabled={!project} onClick={() => onSend(project, permission, split)}>Send to Mac</Button>
    <Button variant="ghost" onClick={onBack}>Choose another recording</Button>
  </div>;
}

/** Step 3: upload progress, then the Mac's analysis phases. */
function SendingStep({ client, video, project, permission, split, onOpenThread, onBack }: { client: CompanionClient; video: BugWalkVideo; project: string; permission: BugWalkPermission; split: BugWalkSplit; onOpenThread: (id: string) => void; onBack: () => void }) {
  const [sent, setSent] = useState(0);
  const [walkId, setWalkId] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [status, setStatus] = useState<BugWalkStatus | null>(null);
  const [pollError, setPollError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sentAt = useRef(0);
  useEffect(() => {
    let live = true;
    setSent(0); setWalkId(''); setUploadError(''); setStatus(null);
    if (!client.bugWalkSend) { setUploadError('This connection cannot send screen recordings.'); return; }
    client.bugWalkSend(video, deviceLabel(), { project, permission_mode: permission, split }, (s, t) => { if (live) setSent(t > 0 ? Math.min(1, s / t) * video.bytes : 0); })
      .then(r => { if (live) { sentAt.current = Date.now(); setSent(video.bytes); setWalkId(r.id); } })
      .catch(e => { if (live) setUploadError(errorText(e)); });
    return () => { live = false; };
  }, [client, video, project, permission, split, attempt]);
  const poll = useCallback(async (live: () => boolean) => {
    if (!client.bugWalkStatus || !walkId) return true;
    try {
      const next = await client.bugWalkStatus(walkId);
      if (!live()) return true;
      setStatus(next); setPollError('');
      return pollingFinished(next, Date.now() - sentAt.current);
    } catch (e) { if (live()) setPollError(errorText(e)); return false; }
  }, [client, walkId]);
  useEffect(() => {
    if (!walkId) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { if (!(await poll(() => live)) && live) timer = setTimeout(tick, POLL_MS); };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [walkId, poll]);
  const uploading = !walkId && !uploadError;
  const session = status?.sessions?.[0];
  return <div className="bug-walk-step" aria-label="Sending">
    <h2>Sending</h2>
    {uploading && <><progress aria-label="Upload progress" max={100} value={progressPercent(sent, video.bytes)} /><p role="status">Uploading {progressPercent(sent, video.bytes)}%</p></>}
    {uploadError && <><p className="bug-walk-error" role="alert">{uploadError}</p><Button onClick={() => setAttempt(a => a + 1)}>Retry</Button><Button variant="ghost" onClick={onBack}>Back</Button></>}
    {walkId && <p role="status">{status ? phaseLabel(status) : 'Checking with your Mac…'}</p>}
    {pollError && <p className="bug-walk-error" role="alert">{pollError}</p>}
    {status?.phase === 'done' && session && <Button onClick={() => onOpenThread(session)}>Open thread</Button>}
    {status?.phase === 'error' && <Button variant="ghost" onClick={onBack}>Back</Button>}
  </div>;
}

export function BugWalkScreen({ client, projects, defaultProject, desktop, onOpenThread, onBack }: Props) {
  const [video, setVideo] = useState<BugWalkVideo | null>(null);
  const [send, setSend] = useState<{ project: string; permission: BugWalkPermission; split: BugWalkSplit } | null>(null);
  const choices = projects.filter(p => p.kind !== 'commander');
  return <section className="companion-schedules-screen companion-bug-walk" data-desktop={desktop || undefined} aria-label="Bug walk">
    <header className="companion-schedules-header">
      <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft /></Button>
      <h1>Bug walk</h1>
    </header>
    <div className="companion-schedules-body">
      {!video ? <RecordStep onVideo={setVideo} />
        : !send ? <SendStep video={video} projects={choices} defaultProject={defaultProject} onBack={() => setVideo(null)} onSend={(project, permission, split) => setSend({ project, permission, split })} />
        : <SendingStep client={client} video={video} {...send} onOpenThread={onOpenThread} onBack={() => setSend(null)} />}
    </div>
  </section>;
}
