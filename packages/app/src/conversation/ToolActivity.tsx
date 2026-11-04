import { ScrollArea } from '@freddai/ui/components/scroll-area';
import type { Message } from '../desktop/types';

// Shared disclosure structure keeps tool visibility identical on Mac and iPhone.
export function ToolActivity({ messages }: { messages: readonly Message[] }) {
  return <details className="tool-activity">
    <summary>Tool activity · {messages.length} {messages.length === 1 ? 'call' : 'calls'}</summary>
    <div className="tool-activity-calls">
      {messages.map((call, index) => <details key={call.id} className="tool-activity-call">
        <summary>Call {index + 1}</summary>
        <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 240 }, 'aria-label': `Tool call ${index + 1} details` }}><pre>{call.text}</pre></ScrollArea>
      </details>)}
    </div>
  </details>;
}
