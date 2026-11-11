import { invoke } from '@tauri-apps/api/core';
import type { Attachment } from '../desktop/types';
import type { Model } from '../desktop/agent-selection';
import type { CommanderClient, CompanionClient, CompanionSnapshot } from './companion';
/** Presents a Mac localhost URL as a native preview; rejects with the native error string (e.g. preview_not_granted). */
export const previewOpen = (threadId: string, url: string) => invoke<void>('preview_open', { threadId, url });
const composer = <T,>(operation: string, input: unknown) => invoke<T>('companion_composer', { operation, input });
// The Mac reports its hardware MAC/broadcast address so the phone can wake it later. Refreshed at most hourly.
let wakeRefreshedAt = 0;
function refreshWakeInfo() {
  if (Date.now() - wakeRefreshedAt < 3_600_000) return;
  wakeRefreshedAt = Date.now();
  invoke('companion_wake_refresh').catch(e => { wakeRefreshedAt = 0; console.warn('Wake details unavailable:', e); });
}
export const nativeCommanderClient: CommanderClient = {
  state: () => composer('commander_state', {}),
  proposals: () => composer('commander_proposals', {}),
  respond: input => composer('commander_proposal_respond', input.prompt === undefined ? { id: input.id, approve: input.approve } : input),
  todos: () => composer('commander_todos', {}),
  saveTodo: todo => composer('commander_todo_save', { todo }),
  notes: () => composer('commander_notes', {}),
  readNote: name => composer('commander_note_read', { name }),
  writeNote: (name, body) => composer('commander_note_write', { name, body }),
};
export const nativeCompanionClient: CompanionClient = {
  commander: nativeCommanderClient,
  projectFolders: (operation, input) => composer(operation, input),
  addProject: path => composer("add_project", { path }),
  updateProjectOrganization: (project, name, color) => composer("update_project_organization", { project, name, color }),
  moveProject: (project, target, after) => composer("move_project", { project, target, after }),
  saveModelConfiguration: configuration => composer("save_model_configuration", { configuration }),
  saveWorkspaces: workspaces => composer("save_workspaces", { workspaces }),
  generatedFile: (thread, href, offset) => composer("generated_file", { thread, href, offset }),
  async snapshot(signal, thread) {
    const value = await invoke<CompanionSnapshot>('companion_snapshot', { thread: thread || null });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    refreshWakeInfo();
    return value;
  },
  scheduleCommand: (operation, input) => composer(operation, input),
  googleCommand: (operation, input) => composer(operation, input),
  wake: () => invoke<number>('companion_wake'),
  hasWakeInfo: async () => !!(await invoke<unknown>('companion_wake_info')),
  models: target => composer<Model[]>('models', target),
  summaries: {
    get: date => composer('day_summary', { date }),
    generate: (date, force) => composer('summarize_day', { date, force }),
  },
  async transcribeAudio(audio) {
    if (!audio.size || audio.size > 10 * 1024 * 1024) throw new Error('Record between 1 byte and 10 MB of audio.');
    const id = await composer<string>('upload', { action: 'begin', name: audio.type.includes('wav') ? 'dictation.wav' : audio.type.includes('mp4') ? 'dictation.m4a' : 'dictation.webm' });
    for (let offset = 0; offset < audio.size; offset += 24 * 1024) {
      const bytes = new Uint8Array(await audio.slice(offset, offset + 24 * 1024).arrayBuffer());
      await composer('upload', { action: 'chunk', id, offset, data: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') });
    }
    return composer<{ text: string }>('transcribe', { id, size: audio.size });
  },
  voice: () => composer<{ enabled: boolean; ready: boolean }>('voice', {}),
  transcribe: file => invoke<{ text: string; durationMs: number; model: string }>('companion_transcribe_path', { path: file.path }),
  resume: input => composer<void>('resume_thread', input),
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
