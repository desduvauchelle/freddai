import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { RecordingFeedback } from '../RecordingFeedback';
import { recordingGesture } from '../recording-gesture';
import { macCompatibleRecording } from './recording-audio';
import type { CompanionClient } from './companion';

/** Browser fallback. Native companions render their own hold control and recorder. */
export function DashboardMic({ client, disabled, project, onText, onListening }: {
  client: CompanionClient; disabled: boolean; project: string; onText: (text: string) => void; onListening?: (listening: boolean) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true), generation = useRef(0), pending = useRef(false), cancelled = useRef(false);
  const pointer = useRef<number | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const origin = useRef({ x: 0, y: 0 }), downAt = useRef(0);
  const [gesture, setGesture] = useState({ send: 0, cancel: 0 });
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state]);
  const [error, setError] = useState('');
  useEffect(() => { onListening?.(state === 'recording'); return () => onListening?.(false); }, [state, onListening]);
  function finish(cancel = false) {
    generation.current++; cancelled.current = cancel; pending.current = false; pointer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else if (alive.current) setState(old => old === 'starting' ? 'idle' : old);
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => { if (document.visibilityState === 'hidden') finish(true); };
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false; finish(true);
      stream.current?.getTracks().forEach(track => track.stop());
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => { if (disabled) finish(true); }, [disabled]);
  async function record() {
    if (disabled || pending.current || state !== 'idle') return;
    const token = ++generation.current;
    pending.current = true; cancelled.current = false;
    setError(''); setState('starting');
    try {
      const status = await client.voice?.();
      if (!alive.current || generation.current !== token) return;
      if (!status?.enabled || !status.ready) throw new Error('Enable voice dictation and prepare its model on your Mac first.');
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this web view.');
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || generation.current !== token) { audio.getTracks().forEach(track => track.stop()); return; }
      stream.current = audio;
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(audio, mimeType ? { mimeType } : undefined);
      recorder.current = capture;
      const chunks: Blob[] = []; let bytes = 0;
      const timer = setTimeout(() => { if (capture.state === 'recording') finish(); }, 120_000);
      capture.ondataavailable = event => { chunks.push(event.data); bytes += event.data.size; if (bytes >= 9 * 1024 * 1024 && capture.state === 'recording') finish(); };
      capture.onstop = async () => {
        clearTimeout(timer); audio.getTracks().forEach(track => track.stop()); recorder.current = null; pending.current = false;
        if (!alive.current) return;
        if (cancelled.current) { setState('idle'); return; }
        setState('transcribing');
        try {
          const audio = await macCompatibleRecording(new Blob(chunks, { type: capture.mimeType }));
          if (!alive.current || cancelled.current) return;
          const result = await client.transcribeAudio!(audio);
          if (alive.current) { if (result.text.trim()) onText(result.text); else setError("Didn't catch anything. Try again."); }
        } catch (e) { if (alive.current) setError(String(e)); }
        finally { if (alive.current) setState('idle'); }
      };
      capture.start(1000); setState('recording');
    } catch (e) {
      stream.current?.getTracks().forEach(track => track.stop());
      if (alive.current && generation.current === token) { pending.current = false; setError(String(e)); setState('idle'); }
    }
  }
  return <div style={{ position: 'relative', display: 'inline-flex' }}><Button variant="default" className="dashboard-mic" style={{ touchAction: 'none', userSelect: 'none' }}
    disabled={disabled || state === 'transcribing' || !client.transcribeAudio}
    aria-label={`${state === 'recording' ? 'Stop recording' : 'Dictate task'} in ${project}`}
    title="Tap to record · Hold to talk · Slide left to cancel · Slide up to send"
    onPointerDown={event => {
      if (event.button !== 0 || pointer.current !== null) return;
      event.preventDefault();
      if (state === 'recording') { finish(); return; }
      origin.current = { x: event.clientX, y: event.clientY }; downAt.current = Date.now(); setGesture({ send: 0, cancel: 0 }); setFinger(null);
      pointer.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); void record();
    }}
    onPointerMove={event => {
      if (pointer.current !== event.pointerId) return;
      const point = { x: event.clientX, y: event.clientY }; setGesture(recordingGesture(origin.current, point)); setFinger(point);
    }}
    onPointerUp={event => {
      if (pointer.current !== event.pointerId) return;
      const action = recordingGesture(origin.current, { x: event.clientX, y: event.clientY });
      pointer.current = null; setGesture({ send: 0, cancel: 0 }); setFinger(null);
      if (action.shouldCancel) finish(true);
      else if (state === 'starting' || Date.now() - downAt.current >= 300 || action.shouldSend) finish();
    }}
    onPointerCancel={() => finish(true)} onLostPointerCapture={() => { if (pointer.current !== null) finish(true); }}
    onKeyDown={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) void record(); } if (event.key === 'Escape') finish(true); }}
    onKeyUp={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); finish(); } }}
    onBlur={() => { if (pending.current) finish(true); }}
    onClick={event => { if (event.detail === 0) { if (pending.current) finish(); else void record(); } }}>
    {state === 'recording' ? <Square size={16}/> : <Mic size={16}/>}{state === 'recording' ? 'Release to transcribe' : state === 'transcribing' ? 'Transcribing…' : state === 'starting' ? 'Opening microphone…' : 'Hold to dictate'}
  </Button>{state === 'recording' && <RecordingFeedback elapsed={elapsed} {...gesture} finger={finger} onCancel={() => finish(true)} onSend={() => finish()} />}{error && <p role="alert">{error}</p>}</div>;
}
