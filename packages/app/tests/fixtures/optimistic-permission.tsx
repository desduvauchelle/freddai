import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Permission } from '../../src/desktop/AgentRequest';
import '@freddai/ui/styles.css';
let resolveReply: () => void;
let rejectReply: (error: Error) => void;
Object.assign(window, { calls: 0, accept: () => resolveReply(), fail: () => rejectReply(new Error('Synthetic permission failure')) });
function Fixture() {
  const [id, setId] = useState(1);
  return <><button onClick={() => setId(id + 1)}>Next request</button><Permission key={id} provider="codex" pending={{ id, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'choice', question: 'Which option?', options: [{ label: 'One' }, { label: 'Two' }] }] } }} onReply={() => {
    (window as any).calls++;
    return new Promise<void>((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
  }} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
