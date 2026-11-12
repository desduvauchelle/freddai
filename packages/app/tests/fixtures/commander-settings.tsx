import React from 'react';
import { createRoot } from 'react-dom/client';
import { CommanderSettings } from '../../src/desktop/commander/CommanderSettings';
import { DEFAULT_COMMANDER_SETTINGS } from '../../src/desktop/commander/api';
import '../../src/desktop/commander/commander.css';
const api = { getCommanderSettings: async () => DEFAULT_COMMANDER_SETTINGS, saveCommanderSettings: async (settings: typeof DEFAULT_COMMANDER_SETTINGS) => settings };
let settings = { transcription: 'local', speech: 'local', transcriptionModel: 'openai/whisper-1', speechModel: 'openai/tts-1', voice: 'alloy' };
const speech = async (_op: string, input: any) => { if (input.settings) settings = input.settings; return { settings, keys: { openrouter: false, vercel: false } } as any; };
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 800, margin: 'auto', padding: 16, fontFamily: 'system-ui', '--border': '#ddd', '--background': '#fff', '--foreground': '#222', '--muted-foreground': '#666' } as React.CSSProperties}><CommanderSettings api={api} speechConnection={speech} projects={[{ id: 'freddai', name: 'Freddai' }]} /></main>);
