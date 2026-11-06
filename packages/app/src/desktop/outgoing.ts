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
