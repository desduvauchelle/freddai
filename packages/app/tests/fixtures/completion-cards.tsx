// Offline completion card layout; no accounts, credentials, or provider turns.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompletionCards } from '../../src/conversation/CompletionCards';
import { ThreadLinksProvider } from '../../src/conversation/ThreadLinksContext';
import '@freddai/ui/styles.css';
function Fixture() {
  const [draft, setDraft] = useState('My existing draft');
  const [notices, setNotices] = useState([{ id: 'commander-completions-offline', prompt: 'Light notice (not a user message): finished\n- LiveCase video transcript and summary (aaaaaaaa-1111) ended done\n- Verify companion on a narrow phone and every physical iPad with a very long task title (bbbbbbbb-2222) ended failed' }]);
  const [opened, setOpened] = useState('');
  return <main style={{ maxWidth: 700, margin: 'auto', padding: 16 }}><ThreadLinksProvider threads={[]} projects={[]} onOpen={setOpened}>
    <p>Reviewed the saved result.</p><CompletionCards notices={notices} onPrepare={prompt => setDraft(old => old + '\n\n' + prompt)} onDismiss={id => setNotices(old => old.filter(n => n.id !== id))} />
    <textarea aria-label="Message" style={{ width: '100%', minHeight: 150 }} value={draft} onChange={e => setDraft(e.target.value)} /><output>{opened}</output>
  </ThreadLinksProvider></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
