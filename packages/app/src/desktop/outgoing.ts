import type { Message, Session, ThreadQueue } from './types';

export type OutgoingReply = { thread: string; message: Message; ordinal: number };

// Queue IDs are the send's idempotency key; transcript IDs are host-generated.
// Count matching user messages to distinguish repeated identical prompts.
export function unconfirmedReplies(outgoing: OutgoingReply[], sessions: Session[], queues: ThreadQueue[] = []) {
  return outgoing.filter(reply => !queues.some(queue => queue.session === reply.thread && queue.messages.some(message => message.id === reply.message.id)) &&
    (sessions.find(thread => thread.id === reply.thread)?.messages.filter(message => message.role === 'user' && message.text === reply.message.text).length || 0) < reply.ordinal);
}

export function previewReplies(sessions: Session[], replies: OutgoingReply[]) {
  if (!replies.length) return sessions;
  return sessions.map(thread => {
    const previews = replies.filter(reply => reply.thread === thread.id);
    return previews.length ? { ...thread, messages: [...thread.messages, ...previews.map(reply => reply.message)] } : thread;
  });
}
