/** Voice-call markup shared by transcript rendering and the call controller. */

export const VOICE_CALL_SUFFIX =
  "\n\n<voice-call>Live voice call. Start your reply with <spoken>one or two short plain-language sentences to be read aloud — no markdown, no code, no lists</spoken>, then put any detail, code, links or images after it as usual.</voice-call>";
export const SPOKEN_CAP = 300;

const VOICE_BLOCK = /\s*<voice-call>[\s\S]*?(?:<\/voice-call>|$)/g;

/** Removes the `<voice-call>` instruction block from a user message and reports whether it was present. */
export function stripVoiceCall(text: string): { text: string; voice: boolean } {
  if (!text.includes("<voice-call>")) return { text, voice: false };
  return { text: text.replace(VOICE_BLOCK, "").trimEnd(), voice: true };
}

/** Assistant text for display: `<spoken>X</spoken>` becomes a plain leading paragraph; a still-open tag (streaming) is just dropped. */
export function renderSpoken(text: string): string {
  if (!text.includes("spoken>")) return text;
  return text.replace(/<spoken>([\s\S]*?)<\/spoken>[ \t]*(?:\r?\n)*/g, (_m, inner: string) => `${inner.trim()}\n\n`).replace(/<\/?spoken>/g, "");
}

/** Plain text of markdown, good enough to read aloud. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map(s => s.trim()).filter(Boolean) ?? [];
}

/** Caps text at `cap` characters, preferring the last sentence boundary, then the last word boundary. */
export function capSpoken(text: string, cap = SPOKEN_CAP): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= cap) return clean;
  const head = clean.slice(0, cap);
  const boundary = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (boundary > 0) return head.slice(0, boundary + 1);
  if (/[.!?]$/.test(head)) return head;
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,;:\s]+$/, "")}…`;
}

/** Text to read aloud for one reply: the `<spoken>` block, else the first two sentences of the markdown-stripped reply. Empty when there is nothing speakable. */
export function extractSpoken(reply: string): string {
  const tagged = reply.match(/<spoken>([\s\S]*?)<\/spoken>/);
  if (tagged && stripMarkdown(tagged[1])) return capSpoken(stripMarkdown(tagged[1]));
  const plain = stripMarkdown(reply.replace(/<\/?spoken>/g, " "));
  return capSpoken(sentences(plain).slice(0, 2).join(" "));
}
