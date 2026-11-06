import type { BackgroundTask, Message } from "../desktop/types";

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

/** Match persisted task launch IDs to visible tool groups, including after reopening a thread. */
export function placeBackgroundTasks(items: readonly TranscriptItem[], tasks: readonly BackgroundTask[]) {
  if (!tasks.some(task => task.tool_use_id)) return { placed: new Map<string, BackgroundTask[]>(), unplaced: [...tasks] };
  const launches = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "tools") continue;
    for (const message of item.messages) {
      try {
        const call = JSON.parse(message.text);
        if (call?.type === "tool_use" && typeof call.id === "string") launches.set(call.id, item.id);
      } catch { /* Plain-text tool records have no launch ID. */ }
    }
  }
  const placed = new Map<string, BackgroundTask[]>();
  const unplaced: BackgroundTask[] = [];
  for (const task of tasks) {
    const anchor = task.tool_use_id ? launches.get(task.tool_use_id) : undefined;
    if (anchor) placed.set(anchor, [...(placed.get(anchor) ?? []), task]);
    else unplaced.push(task);
  }
  return { placed, unplaced };
}
