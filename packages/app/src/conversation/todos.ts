import type { Message } from "../desktop/types";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type Todo = { content: string; status: TodoStatus; activeForm: string };

const status = (v: unknown): TodoStatus => v === "completed" ? "completed" : v === "in_progress" ? "in_progress" : "pending";

/** Todos carried by one tool message: Claude `TodoWrite` tool_use JSON, which Codex plans and ACP plans are normalised to by the host. */
export function parseTodos(text: string): Todo[] | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const call = value as { type?: string; name?: string; input?: { todos?: unknown } } | null;
  if (call?.type !== "tool_use" || call.name !== "TodoWrite" || !Array.isArray(call.input?.todos)) return null;
  const todos = call.input.todos.flatMap((t: { content?: unknown; status?: unknown; activeForm?: unknown }) =>
    typeof t?.content === "string" ? [{ content: t.content, status: status(t.status), activeForm: typeof t.activeForm === "string" && t.activeForm ? t.activeForm : t.content }] : []);
  return todos;
}

/** The thread's current todo list: the most recent todo update. */
export function latestTodos(messages: readonly Message[]): Todo[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "tool") continue;
    const todos = parseTodos(messages[i].text);
    if (todos) return todos;
  }
  return [];
}
