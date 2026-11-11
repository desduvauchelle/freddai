import { sendDisposition, logClassified, type SendDisposition } from '../mobile/send-disposition';
import type { LaunchOptions, Message, Session, ThreadQueue } from './types';

export type OutgoingReply = { thread: string; message: Message; ordinal: number; queued?: boolean; options?: LaunchOptions };

// Queue IDs are the send's idempotency key; transcript IDs are host-generated.
// Count matching user messages to distinguish repeated identical prompts.
export function unconfirmedReplies(outgoing: OutgoingReply[], sessions: Session[], queues: ThreadQueue[] = []) {
  return outgoing.filter(reply => !queues.some(queue => queue.session === reply.thread && queue.messages.some(message => message.id === reply.message.id)) &&
    (sessions.find(thread => thread.id === reply.thread)?.messages.filter(message => message.role === 'user' && message.text === reply.message.text).length || 0) < reply.ordinal);
}

export function previewReplies(sessions: Session[], replies: OutgoingReply[]) {
  if (!replies.length) return sessions;
  return sessions.map(thread => {
    const previews = replies.filter(reply => reply.thread === thread.id && !reply.queued);
    return previews.length ? { ...thread, messages: [...thread.messages, ...previews.map(reply => reply.message)] } : thread;
  });
}

export function previewQueues(queues: ThreadQueue[] = [], replies: OutgoingReply[]) {
  const result = queues.slice();
  for (const reply of replies.filter(reply => reply.queued)) {
    const index = result.findIndex(queue => queue.session === reply.thread);
    const queue = index < 0 ? { session: reply.thread, paused: false, error: null, messages: [] } : result[index];
    const updated = { ...queue, messages: [...queue.messages, { id: reply.message.id, prompt: reply.message.text, options: reply.options ?? {} }] };
    if (index < 0) result.push(updated);
    else result[index] = updated;
  }
  return result;
}

/**
 * Desktop send-time classification, sharing the mobile rule. An optimistic reply the snapshot has not
 * confirmed yet (launched or queued) counts as in flight, so a quick second send queues behind it.
 */
export function classifyDesktopSend(args: { task: Session; id: string; outgoing: OutgoingReply[]; sessions: Session[]; queues?: ThreadQueue[]; queuedCount: number }): SendDisposition {
  const { task, id } = args;
  const queue = args.queues?.find(q => q.session === task.id);
  const unreflectedLocal = unconfirmedReplies(args.outgoing, args.sessions, args.queues).filter(reply => reply.thread === task.id && reply.message.id !== id).length;
  const disposition = sendDisposition({ status: task.status, queued: args.queuedCount, queuePaused: !!queue?.paused, queueError: queue?.error, unreflectedLocal });
  logClassified({ env: 'desktop', thread: task.id, id, disposition, status: task.status, queued: args.queuedCount, queuePaused: !!queue?.paused, unreflectedLocal });
  return disposition;
}
