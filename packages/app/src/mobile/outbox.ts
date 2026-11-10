import type { Attachment } from '../desktop/types';
import type { ComposerOptions } from './companion';
import type { NativeFile } from './native-shell';
export const OUTBOX_KEY = 'freddai.companion.outbox.v1';
export type Outgoing = { id: string; thread: string; replyTo?: string; project: string; prompt: string; ordinal: number; startsTurn: boolean; acknowledged: boolean; uploadStatus?: string; attachments: Attachment[]; nativeFiles?: NativeFile[]; assistant?: string; options?: ComposerOptions; deliveryError?: string; blocked?: boolean; attempts?: number; retryAt?: number };
export function readOutbox(): Outgoing[] {
  try {
    const items: Outgoing[] = JSON.parse(localStorage.getItem(outboxKey()) || '[]');
    // Accepted messages belong to the host. Legacy optimistic echoes must not
    // survive a reload as a second, device-owned backlog.
    const pending = items.filter(item => !item.acknowledged);
    if (pending.length !== items.length) {
      try { saveOutbox(pending); } catch { /* Preserve unsent entries even if migration cannot be persisted. */ }
    }
    return pending.map(item => ({ ...item, retryAt: undefined }));
  } catch { return []; }
}
export function saveOutbox(items: Outgoing[]) { localStorage.setItem(outboxKey(), JSON.stringify(items.filter(item => !item.acknowledged))); }
/** Pairing changes get a new namespace; the old queue stays stored without sending to a different Mac. */
function outboxKey() { const scope = localStorage.getItem('freddai.companion.outboxScope'); return scope ? `${OUTBOX_KEY}.${scope}` : OUTBOX_KEY; }
/** Retry only recognized transport/interruption failures; validation errors return to the composer. */
export function retryableDelivery(error: string) {
  if (/revoked|pair.*again|pairing|unauthori[sz]ed|forbidden|certificate/i.test(error)) return false;
  return /relay unavailable|connection interrupted|connection.*(unavailable|reset|closed)|network|fetch|timed? ?out|Mac.*(unreachable|offline|did not respond)|host is upgrading|HTTP (408|429|5\d\d)|body cut off|empty body/i.test(error);
}

/** Backoff before the next delivery attempt: 2s, 4s, 8s, 16s, then capped at 30s. */
export function retryDelayMs(attempts: number) { return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempts - 1)); }
/** Status line for a queued bubble; always names the last failure and when the next attempt happens. */
export function queuedStatus(message: Pick<Outgoing, 'deliveryError' | 'attempts' | 'retryAt'>, connected: boolean, now: number) {
  if (!message.deliveryError) return connected ? 'Sending…' : '◷ Queued · waiting for connection';
  const wait = message.retryAt && connected ? Math.max(0, Math.ceil((message.retryAt - now) / 1000)) : 0;
  const next = !connected ? 'waiting for connection' : wait > 0 ? `retrying in ${wait}s` : 'retrying now';
  return `◷ Queued · last attempt failed: ${message.deliveryError} · ${next}`;
}
