// Real ConversationMascot + Chip in the DesktopApp title-row markup, with synthetic sessions only. Select with ?mood=N.
import { createRoot } from 'react-dom/client';
import { ConversationMascot, ConversationMascotChip } from '../../src/desktop/MascotScenes';
import type { Session } from '../../src/desktop/types';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';
const base: Session = { id: 's', project: 'p', account: 'a', title: 'Synthetic conversation', status: 'idle', updated: 1, provider_id: null, messages: [], pending: null, error: null };
const byMood: Record<number, { s: Partial<Session>; read: Record<string, number> }> = {
  0: { s: {}, read: {} },
  2: { s: { status: 'running' }, read: {} },
  4: { s: { status: 'waiting', pending: {} as any }, read: {} },
  6: { s: { status: 'done' }, read: { s: 1 } },
  8: { s: { status: 'failed', error: 'synthetic' }, read: {} },
};
const mood = Number(new URLSearchParams(location.search).get('mood') ?? 0);
const { s, read } = byMood[mood];
const thread = { ...base, ...s };
createRoot(document.getElementById('root')!).render(
  <div className="detail-heading" data-testid="header" style={{ width: 520, padding: '12px 16px', background: 'var(--background, #fff)' }}>
    <div className="detail-title-row">
      <ConversationMascot thread={thread} sessions={[thread]} read={read} />
      <h1>Synthetic conversation</h1>
      <ConversationMascotChip thread={thread} sessions={[thread]} read={read} />
    </div>
  </div>);
