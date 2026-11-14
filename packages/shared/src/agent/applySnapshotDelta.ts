/** Merges a host `snapshot_since` reply into the previous raw snapshot.
 *
 * The host sends `sessionIds` (every session, in display order) plus full bodies only for sessions that
 * changed since the client's revision, and every other top-level Database field in full. Unchanged
 * sessions keep the exact object from `prev`, so `reconcileSnapshot` has nothing to compare for them. */
import type { Database, Session } from "./types";

export type SnapshotReply = {
  desktopProjection?: boolean;
  revision: number;
  hostId: string;
  unchanged?: boolean;
  full?: boolean;
  sessionIds?: string[];
  messageIds?: Record<string, string[]>;
  sessions?: Session[];
  build?: string | null;
} & Partial<Omit<Database, "sessions">>;

/** Returns the next Database, `prev` itself for an `unchanged` reply, or `null` when the reply cannot be
 * applied (a session the host omitted is unknown locally): the caller must refetch with revision 0. */
export function applySnapshotDelta(prev: Database, reply: SnapshotReply): Database | null {
  if (reply.unchanged) return prev;
  const { revision: _r, hostId: _h, unchanged: _u, full, sessionIds, messageIds, sessions = [], build: _b, desktopProjection: _projection, ...rest } = reply;
  let ordered: Session[];
  if (full || !sessionIds) {
    ordered = sessions;
  } else {
    const fresh = new Map(sessions.map(s => [s.id, s] as const));
    const old = new Map(prev.sessions.map(s => [s.id, s] as const));
    ordered = [];
    for (const id of sessionIds) {
      const session = fresh.get(id) ?? old.get(id);
      if (!session) return null;
      const ids = messageIds?.[id];
      if (ids && fresh.has(id)) {
        const previous = old.get(id);
        if (!previous) return null;
        const messages = new Map(previous.messages.map(m => [m.id, m]));
        for (const message of session.messages) messages.set(message.id, message);
        const merged: Session['messages'] = [];
        for (const messageId of ids) {
          const message = messages.get(messageId);
          if (!message) return null;
          merged.push(message);
        }
        ordered.push({ ...session, messages: merged });
      } else ordered.push(session);
    }
  }
  return { ...prev, ...(rest as Partial<Database>), sessions: ordered };
}
