import { useEffect, useState } from 'react';
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { NativeThreadsModel } from './native-threads';

/**
 * Bridge to the iOS-only `native-shell` Tauri plugin (UINavigationController + native composer).
 * Everything here is inert outside the Tauri iOS build: probing resolves false and the senders no-op.
 */
const PLUGIN = 'native-shell';
let available = false;
let probe: Promise<boolean> | null = null;

function inTauriIos(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** True once the iOS plugin has answered a probe. Synchronous; call `probeNativeShell` (or use the hook) first. */
export function isNativeShell(): boolean { return available; }

export function probeNativeShell(): Promise<boolean> {
  if (!inTauriIos()) return Promise.resolve(false);
  probe ||= invoke<{ installed?: boolean }>(`plugin:${PLUGIN}|ping`)
    .then(result => (available = !!result?.installed))
    .catch(() => (available = false));
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

export type NativeMode = 'conversation' | 'new' | 'other';
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
export type NativeThreadMeta = { project: string; runState: 'running' | 'waiting' | 'failed' | ''; canStop: boolean; canReview: boolean; canArchive: boolean; canDelete: boolean };
export function setThreadMeta(meta: NativeThreadMeta): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_thread_meta`, { meta });
}

export function setComposerText(text: string): Promise<void> {
  if (!available) return Promise.resolve();
  return invoke<void>(`plugin:${PLUGIN}|set_composer_text`, { text });
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!available) return () => {};
  const listener = await addPluginListener<T>(PLUGIN, event, handler);
  return () => { void listener.unregister(); };
}

/** Subscribes to native composer sends. Resolves to an unsubscribe function. */
export const onComposerSend = (handler: (text: string) => void) => listen<{ text: string }>('composerSend', payload => handler(payload.text));
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
