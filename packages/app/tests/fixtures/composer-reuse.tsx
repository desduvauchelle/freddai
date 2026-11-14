// Entirely in-memory desktop bridge. No account, filesystem, provider or network operations.
import { createRoot } from 'react-dom/client';
import { empty, type Database } from '../../src/desktop/types';
import '@freddai/ui/styles.css';
const db: Database = { ...empty, accounts: [{ id: 'fixture-agent', name: 'Offline fixture', provider: 'claude', color: '#777' }],
  projects: [{ id: 'fixture-project', name: 'Offline project', path: '/offline-fixture', color: '#567', policy: 'fixed', account: 'fixture-agent', last: null }],
  sessions: [], preferences: { ...empty.preferences, fallback: 'fixture-agent' } };
let callback = 0;
const calls: string[] = [];
Object.assign(window, { isTauri: true, __fixtureCalls: calls, __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => ++callback, unregisterCallback: () => {},
  invoke: async (command: string, args: Record<string, any> = {}) => {
    calls.push(command);
    if (command === 'snapshot_since') return { ...db, revision: db.sessions.length + 1, full: true, hostId: 'offline-fixture' };
    if (command === 'launch') {
      db.sessions.push({ id: 'fixture-created', project: args.project, account: args.account, title: args.prompt, status: 'done', updated: Date.now(), provider_id: 'offline', pending: null, error: null, messages: [{ id: 'fixture-message', role: 'user', text: args.prompt }] });
      return 'fixture-created';
    }
    if (command === 'list_slash_commands' || command === 'list_project_files') return [];
    if (command === 'updater_state') return { state: 'idle' };
    if (command === 'day_summary') return { date: args.date, summary: null, running: false, threads: 0 };
    if (command === 'plugin:event|listen') return ++callback;
    return null;
  },
} });
const { DesktopApp } = await import('../../src/desktop/DesktopApp');
createRoot(document.getElementById('root')!).render(<DesktopApp />);
