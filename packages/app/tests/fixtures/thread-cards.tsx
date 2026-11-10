// Offline layout fixture for thread link chips and sub-agent cards: no accounts or provider calls.
import { createRoot } from 'react-dom/client';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import { ThreadTranscript } from '../../src/conversation/ThreadTranscript';
import { ThreadLinksContext, type ThreadLinkInfo } from '../../src/conversation/ThreadLinksContext';
import '@freddai/ui/styles.css';
import '../../src/workspace.css';
import '../../src/desktop/desktop.css';
import '../../src/mobile/mobile.css';
const compact = new URLSearchParams(location.search).has('mobile');
const infos: Record<string, ThreadLinkInfo> = {
  run: { title: 'Fix the login redirect loop on expired sessions', projectName: 'freddai-web', status: 'running' },
  wait: { title: 'Migrate settings storage', projectName: 'freddai', status: 'waiting' },
  done: { title: 'Add dark theme to the companion', projectName: 'freddai', status: 'done' },
  fail: { title: 'Upgrade dependencies', projectName: 'a-very-long-project-name-for-wrapping', status: 'failed' },
};
const call = (id: string, thread: string) => [
  { id: `u${id}`, role: 'tool', text: JSON.stringify({ type: 'tool_use', id, name: 'mcp__freddai__freddai_start_task', input: { prompt: 'x' } }, null, 2) },
  { id: `r${id}`, role: 'tool', text: JSON.stringify({ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify({ thread }) }] }, null, 2) },
];
const messages = [
  { id: 'a', role: 'assistant', text: 'Started four sub-agents. Track [the login fix](freddai://thread/run) and [settings migration](freddai://thread/wait), or see <freddai://thread/done> when it lands. Older: [deps](freddai://thread/fail).' },
  ...call('t1', 'run'), ...call('t2', 'wait'), ...call('t3', 'done'), ...call('t4', 'fail'),
  { id: 'e', role: 'tool', text: JSON.stringify({ type: 'tool_result', tool_use_id: 'q', content: '{"ok":false,"error":"Project not found"}' }) },
  { id: 'eu', role: 'tool', text: JSON.stringify({ type: 'tool_use', id: 'q', name: 'mcp__freddai__freddai_start_task', input: {} }) },
];
createRoot(document.getElementById('root')!).render(<ThreadLinksContext.Provider value={{ openThread: id => console.log('open', id), threadInfo: id => infos[id] }}><div className={compact ? '' : 'native-workspace'} style={{height:'100vh'}}><ScrollArea className={compact ? 'companion-body' : undefined} style={{height:'100%'}} viewportProps={{className:'chat-transcript'}}><ThreadTranscript density={compact ? 'compact' : 'comfortable'} messages={messages} /></ScrollArea></div></ThreadLinksContext.Provider>);
