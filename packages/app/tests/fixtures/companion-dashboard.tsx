import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import { disconnectedClient, type CompanionSnapshot } from '../../src/mobile/companion';
import { localDateKey } from '../../src/desktop/DaySummaries';
import '@freddai/ui/styles.css';
// Offline display data only. No pairing, account setup, or provider requests.
const projects = ['Project One', 'Project Two', 'Project Three', 'A project with a longer name'].map((name, i) => ({
  id: `p${i}`, name, color: '#7c6cf0', canStart: true, defaultAssistant: 'first',
  assistants: [{ id: 'first', name: 'First', provider: 'claude' }, { id: 'second', name: 'Second', provider: 'codex' }],
}));
const snapshot: CompanionSnapshot = { projects, threads: [] };
const calls: unknown[] = [];
Object.assign(window, { dashboardCalls: calls });
createRoot(document.getElementById('root')!).render(<MobileApp client={{ ...disconnectedClient,
  snapshot: async () => structuredClone(snapshot),
  models: async () => [],
  summaries: {
    async get(date) {
      calls.push({ operation: 'day_summary', date });
      return { date, running: false, threads: 2, error: null, summary: date === localDateKey(new Date()) ? {
        date, markdown: '## Cached daily summary\nLoaded from the paired Mac.', generated_at: Date.now(), provider: 'codex', account: '', model: '', threads: 2,
      } : null };
    },
    async generate() { throw new Error('Generation is disabled in this offline fixture.'); },
  },
}} />);
