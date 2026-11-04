/** Recover prompt text only when a stored title is an explicitly shortened prefix. */
export function threadListTitle(title: string, messages: { role: string; text: string }[]): string {
  if (!/(?:…|\.\.\.)$/.test(title)) return title;
  const prefix = title.replace(/(?:…|\.\.\.)$/, "");
  const first = messages.find(message => message.role === "user")?.text;
  if (!first || !prefix) return title;
  const line = first.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  const topic = line.replace(/^#+\s*/, "").replace(/^(?:can you please |could you please |would you please |can you |could you |would you |please |i want you to |i would like to |i want to )/i, "");
  for (const candidate of [line, topic]) {
    const normalized = candidate.replace(/\s+/g, " ");
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) return normalized;
  }
  return title;
}
