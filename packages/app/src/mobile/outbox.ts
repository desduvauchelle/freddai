import type { Attachment } from '../desktop/types';
import type { ComposerOptions } from './companion';
import type { NativeFile } from './native-shell';
export const OUTBOX_KEY = 'freddai.companion.outbox.v1';
export type Outgoing = { id: string; thread: string; project: string; prompt: string; ordinal: number; startsTurn: boolean; acknowledged: boolean; uploadStatus?: string; attachments: Attachment[]; nativeFiles?: NativeFile[]; assistant?: string; options?: ComposerOptions; deliveryError?: string; blocked?: boolean };
export function readOutbox(): Outgoing[] {
  try { return JSON.parse(localStorage.getItem(outboxKey()) || '[]'); } catch { return []; }
}
export function saveOutbox(items: Outgoing[]) { localStorage.setItem(outboxKey(), JSON.stringify(items)); }
/** Pairing changes get a new namespace; the old queue stays stored without sending to a different Mac. */
function outboxKey() { const scope = localStorage.getItem('freddai.companion.outboxScope'); return scope ? `${OUTBOX_KEY}.${scope}` : OUTBOX_KEY; }
/** Retry only recognized transport/interruption failures; validation errors return to the composer. */
export function retryableDelivery(error: string) {
  if (/revoked|pair.*again|pairing|unauthori[sz]ed|forbidden|certificate/i.test(error)) return false;
  return /relay unavailable|connection interrupted|connection.*(unavailable|reset|closed)|network|fetch|timed? ?out|Mac.*(unreachable|offline|did not respond)|host is upgrading|HTTP (408|429|5\d\d)|body cut off|empty body/i.test(error);
}
