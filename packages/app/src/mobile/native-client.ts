import { invoke } from '@tauri-apps/api/core';
import type { Attachment } from '../desktop/types';
import type { Model } from '../desktop/agent-selection';
import type { CompanionClient, CompanionSnapshot } from './companion';
const composer = <T,>(operation: string, input: unknown) => invoke<T>('companion_composer', { operation, input });
export const nativeCompanionClient: CompanionClient = {
  async snapshot(signal) {
    const value = await invoke<CompanionSnapshot>('companion_snapshot');
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return value;
  },
  models: target => composer<Model[]>('models', target),
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
  action: input => invoke<void>('companion_action', input),
  markRead: input => invoke<void>('companion_mark_read', { thread: input.thread, at: input.at }),
  mergeRead: cursors => invoke<void>('companion_merge_read', { cursors }),
  start: input => invoke<string>('companion_start', { project: input.project, assistant: input.assistant, prompt: input.prompt, requestId: input.requestId, options: input.options }),
  respond: input => invoke<void>('companion_respond', { thread: input.thread, requestId: input.requestId, allow: input.allow, answers: input.answers }),
  reply: input => invoke<void>('companion_reply', { thread: input.thread, prompt: input.prompt, requestId: input.requestId, options: input.options }),
};
