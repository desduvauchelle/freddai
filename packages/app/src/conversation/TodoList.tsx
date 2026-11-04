import { Check, Circle, LoaderCircle, ListChecks } from "lucide-react";
import type { Message } from "../desktop/types";
import { latestTodos, type Todo } from "./todos";

/** A compact checklist: completed items struck through, the in-progress item shown by its active form. */
export function TodoChecklist({ todos }: { todos: readonly Todo[] }) {
  return <ul className="todo-list">
    {todos.map((todo, index) => <li key={index} data-status={todo.status}>
      {todo.status === "completed" ? <Check size={13} aria-label="Completed" /> : todo.status === "in_progress" ? <LoaderCircle size={13} aria-label="In progress" /> : <Circle size={13} aria-label="Pending" />}
      <span>{todo.status === "in_progress" ? todo.activeForm : todo.content}</span>
    </li>)}
  </ul>;
}

/** Pinned panel above the composer with the thread's latest todo list. Hidden when there is none, or when everything is done and the agent is idle. */
export function TodoPanel({ messages, active = false }: { messages: readonly Message[]; active?: boolean }) {
  const todos = latestTodos(messages);
  if (!todos.length) return null;
  const done = todos.filter(t => t.status === "completed").length;
  if (done === todos.length && !active) return null;
  const current = todos.find(t => t.status === "in_progress");
  return <details className="todo-panel" open aria-label="Task list">
    <summary><ListChecks size={14} aria-hidden="true" /><span>Tasks · {done}/{todos.length} done</span>{current && <small>{current.activeForm}</small>}</summary>
    <TodoChecklist todos={todos} />
  </details>;
}
