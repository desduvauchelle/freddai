/**
 * A sent message is classified exactly once, at send time:
 *  - 'bubble': the thread is idle with nothing queued or in flight, so the message is the turn itself.
 *  - 'queue':  anything else; the message goes straight to the queue row and is never shown as a bubble first.
 * Mobile and desktop both use this so the rule cannot diverge.
 */
export type SendDisposition = 'bubble' | 'queue';

export const BUSY_STATUSES = ['starting', 'running', 'waiting'];

export type DispositionInput = {
  /** True when the send creates a new thread (nothing can be ahead of it). */
  isNewThread?: boolean;
  status?: string;
  /** Host queue length (or the snapshot's `queued` count). */
  queued?: number;
  queuePaused?: boolean;
  queueError?: string | null;
  /** Local outgoing messages for this thread (acknowledged or not) that the snapshot transcript does not reflect yet. */
  unreflectedLocal?: number;
};

export function sendDisposition(input: DispositionInput): SendDisposition {
  if (input.isNewThread) return 'bubble';
  if (input.status && BUSY_STATUSES.includes(input.status)) return 'queue';
  if ((input.queued ?? 0) > 0 || input.queuePaused || input.queueError) return 'queue';
  if ((input.unreflectedLocal ?? 0) > 0) return 'queue';
  return 'bubble';
}

/**
 * Local messages on `thread` whose text the transcript does not yet contain `ordinal` times.
 * Acknowledged messages count: the host accepted them but the snapshot may not show the turn yet.
 */
export function countUnreflected(
  local: { thread: string; prompt: string; ordinal: number }[],
  thread: string,
  messages: { role: string; text: string }[] = [],
): number {
  return local.filter(m => m.thread === thread &&
    messages.filter(x => x.role === 'user' && x.text === m.prompt).length < m.ordinal).length;
}

/** Structured diagnostic line; every send site logs one per classification. */
export function logClassified(fields: { env: 'mobile' | 'desktop'; thread: string; id: string; disposition: SendDisposition; status?: string; queued?: number; queuePaused?: boolean; unreflectedLocal: number; snapshotAgeMs?: number }) {
  console.info('[send-disposition]', JSON.stringify({ event: 'classified', ...fields }));
}
export function logMisclassified(fields: Record<string, unknown>) {
  console.warn('[send-disposition]', JSON.stringify({ event: 'misclassified', ...fields }));
}
