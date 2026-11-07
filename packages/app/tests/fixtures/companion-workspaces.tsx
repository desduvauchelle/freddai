import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import { disconnectedClient, type CompanionSnapshot } from '../../src/mobile/companion';
import '@freddai/ui/styles.css';
const data: CompanionSnapshot = {
  projects: [{ id: 'a', name: 'Alpha', color: '#112233', canStart: false }, { id: 'b', name: 'Beta', color: '#445566', canStart: false }],
  workspaces: [{ id: 'w', name: 'Work', color: '#112233', projects: ['a'] }],
  threads: ['a','b'].map(id => ({ id, project: id, title: `Task ${id}`, pinned: false, status: 'done', updated: 1, messages: [], canReply: false, queued: 0, error: null })),
};
createRoot(document.getElementById('root')!).render(<MobileApp client={{ ...disconnectedClient,
  async snapshot() { return structuredClone(data); },
  async saveWorkspaces(next) { data.workspaces = structuredClone(next); },
  async action({thread, action}) { const target = data.threads.find(t => t.id === thread)!; if (action === 'pin' || action === 'unpin') target.pinned = action === 'pin'; },
}}/>);
