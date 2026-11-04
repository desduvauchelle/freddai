import { ScrollArea } from '@freddai/ui/components/scroll-area';
import type { Message } from '../desktop/types';
import { parseTodos } from './todos';
import { TodoChecklist } from './TodoList';

// Shared disclosure structure keeps tool visibility identical on Mac and iPhone.
export function ToolActivity({ messages, className }: { messages: readonly Message[]; className?: string }) {
  return <details className={className ? `tool-activity ${className}` : "tool-activity"}>
    <summary>Tool activity · {messages.length} {messages.length === 1 ? 'call' : 'calls'}</summary>
    <div className="tool-activity-calls">
      {messages.map((call, index) => {
        const todos = parseTodos(call.text);
        if (todos) return <details key={call.id} className="tool-activity-call">
          <summary>Call {index + 1} · Task list</summary>
          <TodoChecklist todos={todos} />
        </details>;
        return <details key={call.id} className="tool-activity-call">
          <summary>Call {index + 1}</summary>
          <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 240 }, 'aria-label': `Tool call ${index + 1} details` }}><pre>{call.text}</pre></ScrollArea>
        </details>;
      })}
    </div>
  </details>;
}
