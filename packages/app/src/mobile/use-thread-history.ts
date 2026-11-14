import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Message } from '../desktop/types';
import type { CompanionClient, CompanionThread } from './companion';

export function mergeHistory(older: Message[], newer: Message[]): Message[] {
  const updates = new Map(newer.map(message => [message.id, message]));
  const seen = new Set(older.map(message => message.id));
  return [...older.map(message => updates.get(message.id) ?? message), ...newer.filter(message => !seen.has(message.id))];
}

/** Keep the viewed window across polls; release it when leaving the thread. */
export function useThreadHistory(thread: CompanionThread | undefined, client: CompanionClient, viewport: RefObject<HTMLDivElement | null>) {
  const [window, setWindow] = useState<{ id: string; messages: Message[]; before?: string | null }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const current = useRef(thread?.id); current.current = thread?.id;
  const request = useRef(0), busy = useRef(false);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    request.current++; busy.current = false; setLoading(false); setError(''); anchor.current = null;
    setWindow(undefined);
  }, [thread?.id]);
  useLayoutEffect(() => {
    if (!thread || thread.messagesLoaded === false) return;
    setWindow(previous => {
      if (previous?.id === thread.id && !previous.messages.length && !thread.messages.length && previous.before === thread.historyBefore) return previous;
      // A disjoint fresh window means we missed more than a page while disconnected.
      // Reset to the latest page so we never silently display a gap as contiguous history.
      const overlap = previous?.id === thread.id && thread.messages.some(m => previous.messages.some(p => p.id === m.id));
      return { id: thread.id, messages: overlap ? mergeHistory(previous!.messages, thread.messages) : thread.messages,
        before: overlap ? previous!.before : thread.historyBefore };
    });
  }, [thread?.id, thread?.messages, thread?.historyBefore, thread?.messagesLoaded]);
  useLayoutEffect(() => {
    if (anchor.current && viewport.current) {
      viewport.current.scrollTop = anchor.current.top + viewport.current.scrollHeight - anchor.current.height;
      anchor.current = null;
    }
  }, [window, viewport]);
  const shown = window?.id === thread?.id ? window : undefined;
  async function loadOlder() {
    if (!thread || !shown?.before || !client.history || busy.current) return;
    const id = thread.id, before = shown.before, token = ++request.current;
    busy.current = true; setLoading(true); setError('');
    try {
      const page = await client.history(id, before);
      if (current.current !== id || token !== request.current) return;
      const el = viewport.current;
      if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      setWindow(previous => previous?.id === id && previous.before === before ? { ...previous, messages: mergeHistory(page.messages, previous.messages), before: page.before } : previous);
    } catch (reason) {
      if (current.current === id && token === request.current) setError(String(reason));
    } finally {
      if (token === request.current) { busy.current = false; setLoading(false); }
    }
  }
  return { messages: shown?.messages ?? thread?.messages ?? [], hasOlder: !!shown?.before && !!client.history, loading, error, loadOlder };
}
