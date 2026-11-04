import { createRoot } from 'react-dom/client';
import { ConversationActivity } from '../../src/desktop/MascotScenes';
import type { Session } from '../../src/desktop/types';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';

const status = new URLSearchParams(location.search).get('status') as Session['status'] || 'running';
const thread: Session = { id: 'synthetic', title: 'Synthetic conversation', project: 'p', account: 'a', status, updated: 1, provider_id: null, messages: [], pending: null, error: null };
createRoot(document.getElementById('root')!).render(
  <div className="native-workspace" style={{ padding: 24 }}>
    <div className="chat-transcript">
      <div><article className="chat-assistant"><div className="native-message"><p>I’m taking a look at that.</p></div></article><ConversationActivity thread={thread} /></div>
    </div>
  </div>
);
