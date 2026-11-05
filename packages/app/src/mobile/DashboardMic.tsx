import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import type { CompanionClient } from './companion';

/** Records locally; transcription and launch stay on the paired Mac. */
export function DashboardMic({ client, disabled, project, onText }: {
  client: CompanionClient; disabled: boolean; project: string; onText: (text: string) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => {
    alive.current = false;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }; }, []);
  useEffect(() => { if (disabled && recorder.current?.state === 'recording') recorder.current.stop(); }, [disabled]);
  async function record() {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    setError(''); setState('starting');
    try {
      const status = await client.voice?.();
      if (!status?.enabled || !status.ready) throw new Error('Enable voice dictation and prepare its model on your Mac first.');
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this web view.');
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { audio.getTracks().forEach(track => track.stop()); return; }
      stream.current = audio;
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(audio, mimeType ? { mimeType } : undefined);
      recorder.current = capture;
      const chunks: Blob[] = [];
      let bytes = 0;
      const timer = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, 120_000);
      capture.ondataavailable = event => { chunks.push(event.data); bytes += event.data.size; if (bytes >= 9 * 1024 * 1024 && capture.state === 'recording') capture.stop(); };
      capture.onstop = async () => {
        clearTimeout(timer); audio.getTracks().forEach(track => track.stop());
        if (!alive.current) return;
        setState('transcribing');
        try {
          const result = await client.transcribeAudio!(new Blob(chunks, { type: capture.mimeType }));
          if (alive.current) { if (result.text.trim()) onText(result.text); else setError("Didn't catch anything. Try again."); }
        } catch (e) { if (alive.current) setError(String(e)); }
        finally { if (alive.current) setState('idle'); }
      };
      capture.start(1000); setState('recording');
    } catch (e) { stream.current?.getTracks().forEach(track => track.stop()); if (alive.current) { setError(String(e)); setState('idle'); } }
  }
  return <div><Button variant="outline" disabled={state !== 'recording' && (disabled || state !== 'idle' || !client.transcribeAudio)} aria-label={`${state === 'recording' ? 'Stop recording' : 'Dictate task'} in ${project}`} onClick={() => void record()}>
    {state === 'recording' ? <Square size={16}/> : <Mic size={16}/>}{state === 'recording' ? 'Stop' : state === 'transcribing' ? 'Transcribing…' : state === 'starting' ? 'Opening microphone…' : 'Dictate task'}
  </Button>{error && <p role="alert">{error}</p>}</div>;
}
