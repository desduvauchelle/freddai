import { useMemo, useState } from 'react';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import type { Message } from '../desktop/types';
import { parseTodos } from './todos';
import { TodoChecklist } from './TodoList';
import { ToolText } from './ToolText';
import { ThreadCard } from './ThreadCard';
import { parseStartedTasks } from './startTask';

function ToolCall({ call, index }: { call: Message; index: number }) {
  const [open, setOpen] = useState(false);
  const todos = useMemo(() => parseTodos(call.text), [call.text]);
  // Tool calls only exist while the outer disclosure is open.
  return <details className="tool-activity-call" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Call {index + 1}{todos ? ' · Task list' : ''}</summary>
    {open && (todos ? <TodoChecklist todos={todos} /> : <ToolOutput call={call} index={index} />)}
  </details>;
}

function ToolOutput({ call, index }: { call: Message; index: number }) {
  return <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 240 }, 'aria-label': `Tool call ${index + 1} details` }}><>{call.toolTextBytes != null ? <ToolText key={call.toolTextHash} call={call} /> : <pre>{call.text}</pre>}</></ScrollArea>;
}

// Closed disclosures must release their children, not merely hide thousands of DOM nodes.
export function ToolActivity({ messages, className }: { messages: readonly Message[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const started = useMemo(() => parseStartedTasks(messages), [messages]);
  return <>
    <details className={className ? `tool-activity ${className}` : 'tool-activity'} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Tool activity · {messages.length} {messages.length === 1 ? 'call' : 'calls'}</summary>
      {open && <div className="tool-activity-calls">
        {messages.map((call, index) => <ToolCall key={call.id} call={call} index={index} />)}
      </div>}
    </details>
    {started.map(task => task.threadId || task.error ? <ThreadCard key={task.key} label="Sub-agent" threadId={task.threadId} titleHint={task.title ?? (task.threadId ? undefined : 'Task did not start')} error={task.error} /> : null)}
  </>;
}
