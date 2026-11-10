import { createRoot } from 'react-dom/client';
import { CompanionDashboard } from '../../src/mobile/CompanionDashboard';
import { disconnectedClient } from '../../src/mobile/companion';
import '@freddai/ui/styles.css';
import '../../src/mobile/mobile.css';
const calls: unknown[] = [];
Object.assign(window, { officeOrderCalls: calls });
createRoot(document.getElementById('root')!).render(<CompanionDashboard connected nativeCards={new URLSearchParams(location.search).has('native')}
  onOpen={() => {}} onNew={() => {}} onOpenCommander={() => { calls.push({ operation: 'open-commander' }); }} snapshot={{ threads: [], projects: [...(new URLSearchParams(location.search).has('boss') ? [{ id: 'chief', name: 'Ada', color: '#c7a966', kind: 'commander' as const, canStart: true }] : []), ...['Alpha', 'Beta'].map(name => ({ id: name.toLowerCase(), name, color: '#9478db', canStart: true }))] }}
  client={{ ...disconnectedClient, voice: async () => ({ enabled: true, ready: true }),
    transcribeAudio: async () => ({ text: 'Build the requested feature' }), start: async input => { calls.push(input); return 'new-thread'; } }} />);
