// Offline layout fixture. No microphone, account, or provider access.
import { createRoot } from 'react-dom/client';
import { DashboardCall } from '../../src/desktop/DashboardCall';
import type { CallIo } from '../../src/desktop/voiceCall';
const io: CallIo = { start: async () => {}, stop: async () => {}, speak: async () => {}, stopSpeaking: async () => {}, setListening: async () => {}, listen: async handler => { setTimeout(() => handler({ type: 'state', state: 'listening' }), 20); return () => {}; } };
createRoot(document.getElementById('root')!).render(<DashboardCall visible enabled io={io} sendText={async () => { throw new Error('Dispatch is disabled in this fixture'); }} view={{ busy: false, messages: [] }} />);
