import { useEffect, useState } from 'react';
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { NativeThreadsModel } from './native-threads';

/**
 * Bridge to the mobile `native-shell` Tauri plugin (platform navigation + native composer).
 * Everything here is inert outside the Tauri mobile build: probing resolves false and the senders no-op.
 */
const PLUGIN = 'native-shell';
let available = false;
let probe: Promise<boolean> | null = null;

function inTauri(): boolean {
  // iPad WebKit can use a Macintosh user agent. The installed plugin identifies the native shell.
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True once the mobile plugin has answered a probe. Synchronous; call `probeNativeShell` (or use the hook) first. */
export function isNativeShell(): boolean { return available; }

export function probeNativeShell(): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  probe ||= (async () => {
    try {
      // The native plugin may still be waiting for Tauri's root controller to attach.
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await invoke<{ installed?: boolean }>(`plugin:${PLUGIN}|ping`);
        if (result?.installed) return (available = true);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch { /* Desktop builds have no native-shell plugin. */ }
    return (available = false);
  })();
  return probe;
}

export function useNativeShell(): boolean {
  const [native, setNative] = useState(isNativeShell);
  useEffect(() => {
    let live = true;
    void probeNativeShell().then(value => { if (live) setNative(value); });
    return () => { live = false; };
  }, []);
  return native;
}

export type NativeMode = 'conversation' | 'new' | 'dashboard' | 'other';
/** 'conversation' and 'new' show the native bar and drawer; 'other' (pairing, loading) shows neither. */
export function setMode(mode: NativeMode, options: { title?: string; placeholder?: string; openDrawer?: boolean } = {}): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_mode`, { mode, title: options.title ?? null, placeholder: options.placeholder ?? null, openDrawer: options.openDrawer ?? null });
}

/** Pushes the thread list model to the native drawer. Callers should wrap this in `createChangeSender`. */
export function setThreads(model: NativeThreadsModel): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_threads`, { model });
}

/** Pushes the Mac connection state to the native conversation bar's computer icon (green/red/gray). */
export function setConnection(state: 'ok' | 'down' | 'connecting', message?: string): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_connection`, { state, message: message ?? null });
}

/** Header metadata for the native bar's second line and thread actions menu. All keys are always sent. */
export type NativeThreadMeta = { model?: string | null; access?: string | null; controlsDisabled?: boolean; project: string; runState: 'running' | 'waiting' | 'failed' | ''; canStop: boolean; canReview: boolean; canArchive: boolean; canDelete: boolean };
export function setThreadMeta(meta: NativeThreadMeta): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_thread_meta`, { meta });
}

/** A file the native composer copied into the app's tmp dir. JS only ever sees its path; Rust reads and uploads it. */
export type NativeFile = { path: string; name: string; mime: string; bytes: number };

/** Puts text (and, when `files` is given, the attachment chips) back in the native composer, e.g. after a rejected send. */
export function setComposerText(text: string, files?: NativeFile[]): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_composer_text`, { text, files: files ?? null });
}

/** Shows or hides the mic button; `state` ('idle' | 'transcribing') drives its busy indicator. Omit `state` to leave it unchanged. */
export function setVoice(enabled: boolean, state?: 'idle' | 'transcribing'): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_voice`, { enabled, state: state ?? null });
}

/** Appends dictated text to whatever is currently typed in the native composer (single-space separated). With `submit`, the native composer then sends it like the Send button (typed text + transcript + attachments). */
export function appendComposerText(text: string, submit = false): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|append_composer_text`, { text, submit });
}

/** Deletes tmp copies of attachments once their message was sent. Only files in the native attachment folder are removed. */
export function discardFiles(paths: string[]): Promise<void> {
  if (!available || !paths.length) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|discard_files`, { paths });
}

export type PickerOption = { id: string; label: string; detail?: string; disabled?: boolean };
/** Presents a native selection dialog. Resolves to the chosen option id, or null when dismissed. */
export async function pickOption(input: { title: string; options: PickerOption[]; selected?: string }): Promise<string | null> {
  if (!available) return null;
  const result = await invoke<{ picked?: boolean; id?: string }>(`plugin:${PLUGIN}|pick_option`, { title: input.title, options: input.options, selected: input.selected ?? null });
  return result?.picked && typeof result.id === 'string' ? result.id : null;
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!available) return () => {};
  const listener = await addPluginListener<T>(PLUGIN, event, handler);
  return () => { void listener.unregister(); };
}

/** Subscribes to native composer sends (text plus attachment file paths). Resolves to an unsubscribe function. */
export const onComposerSend = (handler: (text: string, files: NativeFile[]) => void) => listen<{ text: string; files?: NativeFile[] }>('composerSend', payload => handler(payload.text, Array.isArray(payload.files) ? payload.files : []));
/** Subscribes to finished dictation recordings (a tmp file path and its length). */
export const onVoiceRecorded = (handler: (path: string, durationMs: number) => void) => listen<{ path: string; durationMs?: number }>('voiceRecorded', payload => { if (typeof payload?.path === 'string') handler(payload.path, Number(payload.durationMs) || 0); });
/** Subscribes to native dictation errors such as denied microphone access. */
export const onVoiceError = (handler: (message: string) => void) => listen<{ message?: string }>('voiceError', payload => handler(typeof payload?.message === 'string' && payload.message ? payload.message : 'Dictation failed.'));
/** Subscribes to the native navigation bar back button. Resolves to an unsubscribe function. */
export const onNavBack = (handler: () => void) => listen<unknown>('navBack', () => handler());
/** Subscribes to taps on the native connection icon. Resolves to an unsubscribe function. */
export const onConnectionTap = (handler: () => void) => listen<unknown>('connectionTap', () => handler());

/** Subscribes to the native thread actions menu. */
export const onThreadAction = (handler: (payload: { action?: unknown }) => void) => listen<{ action?: unknown }>('threadAction', handler);

/** Drawer events. Each resolves to an unsubscribe function. */
export const onSelectThread = (handler: (payload: { id?: unknown }) => void) => listen<{ id?: unknown }>('selectThread', handler);
export const onSearch = (handler: (payload: { query?: unknown }) => void) => listen<{ query?: unknown }>('search', handler);
export const onSetFilter = (handler: (payload: { project?: unknown; status?: unknown }) => void) => listen<{ project?: unknown; status?: unknown }>('setFilter', handler);
export const onNewThread = (handler: (payload: { project?: unknown }) => void) => listen<{ project?: unknown }>('newThread', handler);
export const onShowOlder = (handler: (payload: { project?: unknown }) => void) => listen<{ project?: unknown }>('showOlder', handler);

export const onDashboard = (handler: () => void) => listen<unknown>('dashboard', handler);
