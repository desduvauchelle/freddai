/** Internal notices the host injects into a Commander thread as "user" messages (see crates/core/src/commander_autonomy.rs).
 *  They are tagged only by their first line: `<Label> (… not a user message): …`, so detection is a prefix match on that line. */
export type SystemNotice = { kind: 'completion' | 'due' | 'heartbeat' | 'other'; summary: string };

const HEADER = /^([A-Z][A-Za-z ]{0,30}?) \((?:[^()\n]*?, )?not a user message\)/;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function parseSystemNotice(text: string): SystemNotice | null {
  const lines = text.split('\n');
  const head = HEADER.exec(lines[0] ?? '');
  if (!head) return null;
  const items = lines.slice(1).filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
  const label = head[1].toLowerCase();
  if (label === 'light notice') {
    // "<title> (<uuid>) ended <status>"
    const parsed = items.map(i => /^(.*?) \([0-9a-f-]{8,}\) ended (\S+)$/i.exec(i)).map((m, i) => ({ title: m?.[1] ?? items[i], status: m?.[2] }));
    const first = parsed[0];
    const detail = first ? `${clip(first.title)}${first.status ? ` — ${first.status}` : ''}` : '';
    const more = parsed.length > 1 ? ` (+${parsed.length - 1} more)` : '';
    return { kind: 'completion', summary: `${plural(parsed.length || 1, 'thread', 'threads')} finished${detail ? `: ${detail}${more}` : ''}` };
  }
  if (label === 'due notice') {
    const first = items[0] ? /^(.*?) \(todo [^)]*\)/.exec(items[0])?.[1] ?? items[0] : '';
    const more = items.length > 1 ? ` (+${items.length - 1} more)` : '';
    return { kind: 'due', summary: `${plural(items.length || 1, 'to-do', 'to-dos')} due${first ? `: ${clip(first)}${more}` : ''}` };
  }
  if (label === 'heartbeat') return { kind: 'heartbeat', summary: 'Scheduled check-in' };
  return { kind: 'other', summary: `${head[1]}` };
}

/** Keep stable thread identities and full titles for completion cards, including legacy queued notices. */
export function completionThreads(text: string): { id: string; title: string; status: string }[] {
  if (parseSystemNotice(text)?.kind !== 'completion') return [];
  return text.split('\n').flatMap(line => {
    const match = /^- (.*?) \(([0-9a-f-]{8,})\) ended (\S+)$/i.exec(line);
    return match ? [{ title: match[1], id: match[2], status: match[3] }] : [];
  });
}

/** Host wake inputs never count as queued user messages or occupy conversation space. */
export const isBackgroundWake = (message: { id: string; prompt: string }) =>
  message.id.startsWith('commander-') || parseSystemNotice(message.prompt) !== null;
