import { invoke } from '@tauri-apps/api/core';
import type { Attachment } from '../desktop/types';
import type { Model } from '../desktop/agent-selection';
import type { CompanionClient, CompanionSnapshot } from './companion';
const composer = <T,>(operation: string, input: unknown) => invoke<T>('companion_composer', { operation, input });
// The Mac reports its hardware MAC/broadcast address so the phone can wake it later. Refreshed at most hourly.
let wakeRefreshedAt = 0;
function refreshWakeInfo() {
  if (Date.now() - wakeRefreshedAt < 3_600_000) return;
  wakeRefreshedAt = Date.now();
  invoke('companion_wake_refresh').catch(e => { wakeRefreshedAt = 0; console.warn('Wake details unavailable:', e); });
}
export const nativeCompanionClient: CompanionClient = {
  async snapshot(signal, thread) {
    const value = await invoke<CompanionSnapshot>('companion_snapshot', { thread: thread || null });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    refreshWakeInfo();
    return value;
  },
  wake: () => invoke<number>('companion_wake'),
  hasWakeInfo: async () => !!(await invoke<unknown>('companion_wake_info')),
  models: target => composer<Model[]>('models', target),
  summaries: {
    get: date => composer('day_summary', { date }),
    generate: (date, force) => composer('summarize_day', { date, force }),
  },
  async transcribeAudio(audio) {
    if (!audio.size || audio.size > 10 * 1024 * 1024) throw new Error('Record between 1 byte and 10 MB of audio.');
    const id = await composer<string>('upload', { action: 'begin', name: audio.type.includes('mp4') ? 'dictation.m4a' : 'dictation.webm' });
    for (let offset = 0; offset < audio.size; offset += 24 * 1024) {
      const bytes = new Uint8Array(await audio.slice(offset, offset + 24 * 1024).arrayBuffer());
      await composer('upload', { action: 'chunk', id, offset, data: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') });
    }
    return composer<{ text: string }>('transcribe', { id, size: audio.size });
  },
  voice: () => composer<{ enabled: boolean; ready: boolean }>('voice', {}),
  transcribe: file => invoke<{ text: string; durationMs: number; model: string }>('companion_transcribe_path', { path: file.path }),
  queue: input => composer<void>('queue', input),
  async attach(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error('Each attachment must be 25 MB or smaller');
    const id = await composer<string>('upload', { action: 'begin', name: file.name });
    for (let offset = 0; offset < file.size; offset += 24 * 1024) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 24 * 1024).arrayBuffer());
      const data = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      await composer('upload', { action: 'chunk', id, offset, data });
    }
    return composer<Attachment>('upload', { action: 'finish', id, size: file.size });
  },
  attachPath: file => invoke<Attachment>('companion_upload_path', { path: file.path, name: file.name, mime: file.mime }),
  action: input => invoke<void>('companion_action', input),
  markRead: input => invoke<void>('companion_mark_read', { thread: input.thread, at: input.at }),
  mergeRead: cursors => invoke<void>('companion_merge_read', { cursors }),
  start: input => invoke<string>('companion_start', { project: input.project, assistant: input.assistant, prompt: input.prompt, requestId: input.requestId, options: input.options }),
  respond: input => invoke<void>('companion_respond', { thread: input.thread, requestId: input.requestId, allow: input.allow, answers: input.answers }),
  reply: input => invoke<void>('companion_reply', { thread: input.thread, prompt: input.prompt, requestId: input.requestId, options: input.options }),
};
