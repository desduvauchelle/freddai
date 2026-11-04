import type { Message } from "../desktop/types";

export type TranscriptItem =
  | { kind: "message"; id: string; message: Message }
  | { kind: "tools"; id: string; messages: Message[] };

// Group only adjacent tool records so conversation order stays intact.
export function groupTranscript(messages: readonly Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const message of messages) {
    const previous = items.at(-1);
    if (message.role === "tool") {
      if (previous?.kind === "tools") previous.messages.push(message);
      else items.push({ kind: "tools", id: message.id, messages: [message] });
    } else {
      items.push({ kind: "message", id: message.id, message });
    }
  }
  return items;
}
