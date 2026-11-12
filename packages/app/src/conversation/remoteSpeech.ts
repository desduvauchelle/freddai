import type { CallEvent } from '../desktop/voiceCall';
import type { SpeechConnection } from '../desktop/commander/SpeechSettings';
/** Per-call playback; cancellation invalidates in-flight synthesis before it can start audio. */
export function remoteSpeech(connection: SpeechConnection, emit: (event: CallEvent) => void) {
  let generation = 0, audio: HTMLAudioElement | null = null;
  return {
    async speak(text: string): Promise<boolean> {
      const token = ++generation;
      const result = await connection<{ local?: boolean; dataUrl?: string }>('speak', { text });
      if (token !== generation) return true;
      if (result.local) return false;
      if (!result.dataUrl?.startsWith('data:audio/mpeg;base64,')) throw new Error('Speech provider returned no playable audio.');
      audio?.pause();
      const playing = audio = new Audio(result.dataUrl);
      playing.onended = () => { if (token === generation) { audio = null; emit({ type: 'tts-end' }); } };
      playing.onerror = () => { if (token === generation) { audio = null; emit({ type: 'state', state: 'error', error: 'Could not play spoken reply.' }); emit({ type: 'tts-end' }); } };
      await playing.play();
      if (token !== generation) { playing.pause(); return true; }
      emit({ type: 'tts-start' }); return true;
    },
    stop() { generation++; if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; emit({ type: 'tts-end' }); } },
  };
}
