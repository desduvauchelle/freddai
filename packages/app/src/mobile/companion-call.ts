import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { CallEvent, CallIo } from '../desktop/voiceCall';
import type { CompanionClient } from './companion';
import { discardFiles, hasNativeVoiceCall } from './native-shell';
import { macCompatibleRecording } from './recording-audio';

/** Per-call transport; no microphone or audio is opened until Start call. */
export function companionCallIo(client: CompanionClient): CallIo {
  let handler: (event: CallEvent) => void = () => {};
  let active = false, generation = 0;
  let tail = Promise.resolve();
  const native = hasNativeVoiceCall();
  const command = (action: string, text?: string) => invoke<void>('plugin:native-shell|call_control', { action, text: text ?? null });
  let stream: MediaStream | null = null, context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null, capture: MediaRecorder | null = null;
  let listening = true, heard = false, lastSound = 0, began = 0;
  const state = (value: 'listening' | 'paused' | 'error', error?: string) => handler({ type: 'state', state: value, error });
  const error = (e: unknown) => state('error', e instanceof Error ? e.message : String(e));
  function transcribe(work: () => Promise<{ text: string }>, token: number, discard?: () => void) {
    tail = tail.then(async () => {
      if (!active || token !== generation) { discard?.(); return; }
      try {
        const result = await work();
        if (active && token === generation && result.text.trim()) handler({ type: 'segment', text: result.text });
      } catch (e) { if (active && token === generation) error(e); }
    });
  }
  function stopCapture() {
    if (timer) clearInterval(timer);
    timer = null;
    if (capture?.state === 'recording') capture.stop();
    capture = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    void context?.close(); context = null;
  }
  function record() {
    if (!stream || !active || !listening) return;
    const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [], token = generation;
    let speech = false;
    heard = false; began = lastSound = performance.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (speech) transcribe(async () => client.transcribeAudio!(await macCompatibleRecording(new Blob(chunks, { type: recorder.mimeType }))), token);
    };
    // Save whether the segment contained speech before resetting the next one.
    const stop = recorder.stop.bind(recorder);
    recorder.stop = () => { speech = heard; stop(); };
    capture = recorder; recorder.start();
    state('listening');
  }
  return {
    async listen(fn) {
      handler = fn;
      const hide = () => { if (document.visibilityState === 'hidden' && active) { void this.stop(); error('Call ended while Freddai was in the background. Start a new call to resume.'); } };
      document.addEventListener('visibilitychange', hide);
      let off: (() => void) | undefined;
      if (native) {
        const listener = await addPluginListener<CallEvent | { type: 'recording'; path: string }>('native-shell', 'callEvent', event => {
          if (event.type === 'recording') {
            const path = event.path;
            transcribe(() => client.transcribe!({ path }), generation, () => { void discardFiles([path]); });
          } else handler(event);
        });
        off = () => listener.unregister();
      }
      return () => { off?.(); document.removeEventListener('visibilitychange', hide); };
    },
    async start() {
      const token = ++generation;
      const status = await client.voice?.();
      if (token !== generation) return;
      if (!status?.enabled || !status.ready) throw new Error('Enable voice and prepare its model on your Mac first.');
      active = true; listening = true;
      if (native) { await command('start'); if (active && !listening) await command('pause'); return; }
      try {
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active || token !== generation) { audio.getTracks().forEach(track => track.stop()); return; }
        stream = audio;
        context = new AudioContext(); await context.resume();
        const analyser = context.createAnalyser(); analyser.fftSize = 2048;
        context.createMediaStreamSource(audio).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        record();
        timer = setInterval(() => {
          if (!listening || !capture || capture.state !== 'recording') return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const now = performance.now();
          if (rms > 0.018) {
            lastSound = now;
            if (!heard) { heard = true; handler({ type: 'speech-start' }); handler({ type: 'state', state: 'speech' }); }
          }
          if ((heard && now - lastSound > 800) || now - began > 20_000) { capture.stop(); record(); }
        }, 80);
      } catch (e) { active = false; stopCapture(); throw e; }
    },
    async stop() { generation++; active = false; stopCapture(); if (native) await command('stop'); },
    async setListening(value) {
      listening = value;
      if (native) { await command(value ? 'resume' : 'pause'); return; }
      if (!value && capture?.state === 'recording') { heard = false; capture.stop(); }
      stream?.getAudioTracks().forEach(track => { track.enabled = value; });
      if (value) record(); else state('paused');
    },
    async speak(text) {
      if (native) { await command('speak', text); return; }
      if (!window.speechSynthesis) throw new Error('Spoken replies are unavailable on this device.');
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => handler({ type: 'tts-start' });
      utterance.onend = () => handler({ type: 'tts-end' });
      utterance.onerror = event => { error(event.error); handler({ type: 'tts-end' }); };
      window.speechSynthesis.speak(utterance);
    },
    async stopSpeaking() { if (native) await command('stopSpeaking'); else window.speechSynthesis?.cancel(); },
  };
}
