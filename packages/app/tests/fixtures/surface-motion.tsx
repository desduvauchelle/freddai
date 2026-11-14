// Isolated offline fixture: never connects to a provider or starts a task.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSheet } from '../../src/desktop/ProjectSheet';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@freddai/ui/components/dialog';
import '@freddai/ui/styles.css';
function Fixture() {
  const [panel, setPanel] = useState<'project' | 'compose' | null>(null);
  return <>
    <button onClick={() => setPanel('project')}>Open project</button>
    <button onClick={() => setPanel('compose')}>Plus</button>
    {panel && <ProjectSheet project={{ name: 'Motion fixture', color: '#567' }} sessions={[]} read={{}} now={0} threadId={null}
      composing={panel === 'compose'} renderCompose={() => <textarea aria-label="Draft" />}
      onSelectThread={() => {}} onBack={() => setPanel('project')} onClose={() => setPanel(null)} renderThread={() => null} />}
    <Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent><DialogTitle>Dialog</DialogTitle></DialogContent></Dialog>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
