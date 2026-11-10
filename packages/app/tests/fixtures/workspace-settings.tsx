import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceSettings } from '../../src/desktop/WorkspaceSettings';
import '@freddai/ui/styles.css';
import '../../src/mobile/mobile.css';
function Fixture() {
  const [workspaces, save] = useState([
    { id: 'a', name: 'Personal', color: '#b59ae9', projects: ['alpha'] },
    { id: 'b', name: 'Work', color: '#112233', projects: [] as string[] },
  ]);
  return <main className="companion-workspaces" style={{ padding: 20, margin: 'auto', maxWidth: 720 }}>
    <h1>Settings</h1>
    <WorkspaceSettings projects={[{ id: 'alpha', name: 'Alpha', color: '#b59ae9' }, { id: 'beta', name: 'Beta', color: '#112233' }]} workspaces={workspaces} disabled={false} onSave={async next => { save(next); return true; }}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
