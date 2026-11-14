import { useCallback, useEffect, useRef, useState } from "react";
import { busy as isBusy, type Database, type Message, type Pending, type Session } from "@freddai/shared/agent/types";
import { queueMessage, respond, stop as stopSession } from "@freddai/shared/agent/client";
import { useOpenThread } from "../freddaiLink";

/** Same shape as ThreadTranscript's `pending` prop (an outgoing message not yet echoed by the host). */
export type OutgoingMessage = { id: string; text: string; status?: string; sending?: boolean };

export type UseScoutChatOptions = {
  /** Freddai snapshot; null while loading. */
  db: Database | null;
  /** Freddai session id of this chat, or null before the first message. */
  session: string | null;
  /** Called with the new session id after `launch` resolves (persist it: item.thread, localStorage…). */
  onSessionCreated: (id: string) => void | Promise<void>;
  /** Starts the Freddai thread for the first message and resolves with its session id. */
  launch: (prompt: string) => Promise<string>;
  /** Turns the user's text into the prompt actually sent. `first` is true for the launching message. */
  format?: (text: string, first: boolean) => string;
};

export type ScoutChat = {
  thread: Session | undefined;
  messages: readonly Message[];
  /** The agent is working (starting/running/waiting) or a first message is being launched. */
  busy: boolean;
  /** Optimistic outgoing messages, pass straight to ThreadTranscript's `pending`. */
  pending: OutgoingMessage[];
  /** The agent's open request (permission / question), if any. */
  approval: Pending | null;
  /** Resolves true when the host accepted the message, false when it failed (see `error`). */
  send: (text: string) => Promise<boolean>;
  /** Replies to `approval`. Rejects on failure (and sets `error`) so the approval card can show it. */
  approve: (allow: boolean, answers?: Record<string, unknown>) => Promise<void>;
  stop: () => Promise<void>;
  error: string | null;
  clearError: () => void;
};

type Outgoing = OutgoingMessage & { prompt: string; seen: number };

const EMPTY: readonly Message[] = [];
/** Messages of a thread this chat registered via useOpenThread. A summary-only session (not in the
 * snapshot scope yet) reads as empty rather than a partial transcript. */
const transcript = (thread: Session | undefined): readonly Message[] =>
  !thread || thread.transcriptLoaded === false ? EMPTY : thread.messages;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const userCount = (messages: readonly Message[], prompt: string) =>
  messages.filter(m => m.role === "user" && m.text.trim() === prompt.trim()).length;

/** The request id DesktopApp sends to `respond` for a pending request. */
export const approvalRequestId = (pending: Pending) => JSON.stringify(pending.request_id ?? pending.id);

/** One Scout conversation on top of a Freddai session: launch on first send, queue afterwards. */
export function useScoutChat({ db, session, onSessionCreated, launch, format = text => text }: UseScoutChatOptions): ScoutChat {
  useOpenThread(session);
  const thread = session && db ? db.sessions.find(s => s.id === session) : undefined;
  const messages = transcript(thread);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The session id known synchronously, so a second send during launch queues instead of launching twice.
  const current = useRef<string | null>(session);
  const inflight = useRef<Promise<string> | null>(null);
  const seq = useRef(0);
  useEffect(() => { current.current = session; }, [session]);

  // Drop optimistic messages once the snapshot contains them.
  useEffect(() => {
    setOutgoing(list => {
      const next = list.filter(o => o.sending || userCount(messages, o.prompt) <= o.seen);
      return next.length === list.length ? list : next;
    });
  }, [messages]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return false;
    const id = `scout-out-${++seq.current}`;
    let target = current.current;
    if (!target && inflight.current) {
      try { target = await inflight.current; } catch { target = null; }
    }
    const first = !target;
    const prompt = format(text, first);
    const seen = userCount(target ? transcript(db?.sessions.find(s => s.id === target)) : EMPTY, prompt);
    setError(null);
    setOutgoing(list => [...list, { id, text, prompt, seen, sending: true, status: "Sending…" }]);
    try {
      if (target) {
        await queueMessage(target, prompt);
      } else {
        setLaunching(true);
        const started = launch(prompt);
        inflight.current = started;
        const created = await started;
        current.current = created;
        await onSessionCreated(created);
      }
      setOutgoing(list => list.map(o => (o.id === id ? { ...o, sending: false, status: undefined } : o)));
      return true;
    } catch (e) {
      setError(message(e));
      setOutgoing(list => list.filter(o => o.id !== id));
      return false;
    } finally {
      if (first) { setLaunching(false); inflight.current = null; }
    }
  }, [db, format, launch, onSessionCreated]);

  const approve = useCallback(async (allow: boolean, answers: Record<string, unknown> = {}) => {
    const pending = thread?.pending;
    if (!session || !pending) {
      const reason = "There is no open agent request to answer.";
      setError(reason);
      throw new Error(reason);
    }
    try {
      await respond(session, approvalRequestId(pending), allow, answers);
    } catch (e) {
      setError(message(e));
      throw e;
    }
  }, [session, thread?.pending]);

  const stop = useCallback(async () => {
    if (!session) return;
    try { await stopSession(session); } catch (e) { setError(message(e)); }
  }, [session]);

  return {
    thread,
    messages,
    busy: launching || isBusy(thread),
    pending: outgoing.map(({ id, text, status, sending }) => ({ id, text, status, sending })),
    approval: thread?.pending ?? null,
    send,
    approve,
    stop,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
