// Offline layout fixture: no accounts or provider calls.
import { createRoot } from 'react-dom/client';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import { ThreadTranscript } from '../../src/conversation/ThreadTranscript';
import '@freddai/ui/styles.css';
import '../../src/workspace.css';
import '../../src/desktop/desktop.css';
import '../../src/mobile/mobile.css';
const compact = new URLSearchParams(location.search).has('mobile');
const text = `Readable introductory text with a long URL https://example.com/${'path'.repeat(80)}

| Dimension | Claude Code | Hermes | OpenClaw | Today |
| --- | --- | --- | --- | --- |
| Context continuity | Saved sessions, context management and persistent instructions. | Saved tool-call history with compression and recent exchanges. | Persistent session transcript with serialized ownership. | Main chat reloads messages and bounded details. |

More readable text after the table.

- A list item
  - A nested list item

1. First numbered item
2. Second numbered item

> A quoted paragraph`;
createRoot(document.getElementById('root')!).render(<div className={compact ? '' : 'native-workspace'} style={{height:'100vh'}}><ScrollArea className={compact ? 'companion-body' : undefined} style={{height:'100%'}} viewportProps={{className:'chat-transcript'}}><ThreadTranscript density={compact ? 'compact' : 'comfortable'} messages={[{id:'fixture',role:'assistant',text}]} /></ScrollArea></div>);
