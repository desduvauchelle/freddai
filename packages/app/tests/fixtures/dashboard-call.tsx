// Offline layout fixture. No microphone, connected account, or provider access.
import { createRoot } from 'react-dom/client';
import { DashboardCall } from '../../src/desktop/DashboardCall';
import { CompanionCommandCard } from '../../src/mobile/CompanionCommandCard';
import { disconnectedClient } from '../../src/mobile/companion';
import type { CallEvent, CallIo } from '../../src/desktop/voiceCall';
let emit: (event: CallEvent) => void = () => {};
const projects = [{ id: 'layout', name: 'Freddy', color: '#777', canStart: false }];
const io: CallIo = { start: async () => {}, stop: async () => {}, speak: async () => {}, stopSpeaking: async () => {}, setListening: async () => {}, listen: async handler => { emit = handler; return () => {}; } };
createRoot(document.getElementById('root')!).render(<>
  <div id="content" style={{ height: 2400, padding: 16, color: '#ddd' }}>Page content that must stay scrollable during a call.</div>
  <button style={{ position: 'fixed', bottom: 10, left: 10 }} onClick={() => emit({ type: 'segment', text: 'Freddy, send a request to say hello to the project Freddy to see if this is working.' })}>Simulate spoken request</button>
  <DashboardCall visible enabled io={io} sendText={async () => { throw new Error('Dispatch is disabled in this fixture'); }} view={{ busy: false, messages: [] }}
    commandCenter={{ projects, launchDraft: async () => { throw new Error('Dispatch is disabled in this fixture'); }, renderReview: props => <CompanionCommandCard {...props} projects={projects} client={disconnectedClient} assistant="" onAssistant={() => {}} selection={{ model: '', effort: 'default' }} onSelection={() => {}}/> }}/>
</>);
