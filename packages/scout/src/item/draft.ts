import type { Message } from "@freddai/shared/agent/types";

/** An email draft proposed by the agent.
 *
 *  Convention: the latest assistant message contains a fenced code block whose info string is
 *  exactly `draft`. Optional header lines `To: <address>` and `Subject: <text>` come first, then a
 *  blank line, then the body. Example:
 *
 *  ```draft
 *  To: jordan@acme.example
 *  Subject: Re: Pricing for 40 seats
 *
 *  Hi Jordan, …
 *  ```
 *
 *  Scout only renders it; sending email is not connected, so Send stays disabled. */
export type EmailDraft = { messageId: string; to: string | null; subject: string | null; body: string };

const FENCE = /(^|\n)(`{3,}|~{3,})draft[ \t]*\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/;

export function parseDraft(text: string): Omit<EmailDraft, "messageId"> | null {
  const match = FENCE.exec(text);
  if (!match) return null;
  const lines = match[3].split("\n");
  let to: string | null = null, subject: string | null = null, start = 0;
  for (; start < lines.length; start++) {
    const header = /^(To|Subject):\s*(.*)$/i.exec(lines[start]);
    if (!header) break;
    if (header[1].toLowerCase() === "to") to = header[2].trim() || null; else subject = header[2].trim() || null;
  }
  if (start > 0 && lines[start]?.trim() === "") start++;
  const body = lines.slice(start).join("\n").trim();
  return body ? { to, subject, body } : null;
}

/** The draft in the latest assistant message, if that message has one. */
export function latestDraft(messages: readonly Message[]): EmailDraft | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const draft = parseDraft(m.text);
    return draft ? { messageId: m.id, ...draft } : null;
  }
  return null;
}
