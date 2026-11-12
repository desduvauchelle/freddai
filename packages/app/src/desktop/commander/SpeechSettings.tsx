import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
export type SpeechConnection = <T>(operation: string, input: unknown) => Promise<T>;
export const desktopSpeechConnection: SpeechConnection = (operation, input) => invoke('voice_connection', { operation, input });
type Settings = { transcription: string; speech: string; transcriptionModel: string; speechModel: string; voice: string };
type State = { settings: Settings; keys: Record<string, boolean> };
const providers = [['local', 'Local'], ['openrouter', 'OpenRouter'], ['vercel', 'Vercel AI Gateway']];
export function SpeechSettings({ connection = desktopSpeechConnection }: { connection?: SpeechConnection }) {
  const [state, setState] = useState<State | null>(null), [keys, setKeys] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { let alive = true; connection<State>('get', {}).then(s => { if (alive) setState(s); }).catch(e => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, [connection]);
  const patch = (p: Partial<Settings>) => { setState(s => s && ({ ...s, settings: { ...s.settings, ...p } })); setSaved(false); };
  async function save() { if (!state) return; setBusy(true); setError(''); setSaved(false); try { setState(await connection<State>('save', { settings: state.settings, keys })); setKeys({}); setSaved(true); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  return <section className="commander-profile commander-settings" aria-label="Voice connections">
    <h3>Voice connections</h3><p className="commander-muted">Local transcription runs on your Mac; local replies use this device’s voice. Remote audio goes to the provider you select. Keys stay in your Mac’s Keychain.</p>
    {error && <p role="alert" className="commander-error">{error}</p>}
    {state && <><div className="commander-budget">
      <label>Voice to text<select value={state.settings.transcription} onChange={e => patch({ transcription: e.target.value })}>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {state.settings.transcription !== 'local' && <label>Transcription model<input value={state.settings.transcriptionModel} onChange={e => patch({ transcriptionModel: e.target.value })} /></label>}
      <label>Text to voice<select value={state.settings.speech} onChange={e => patch({ speech: e.target.value })}>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {state.settings.speech !== 'local' && <><label>Speech model<input value={state.settings.speechModel} onChange={e => patch({ speechModel: e.target.value })} /></label><label>Voice ID<input value={state.settings.voice} onChange={e => patch({ voice: e.target.value })} /></label></>}
      {providers.slice(1).map(([id, name]) => <label key={id}>{name} API key {state.keys[id] ? '(saved)' : ''}<input type="password" autoComplete="off" value={keys[id] ?? ''} placeholder={state.keys[id] ? 'Leave blank to keep saved key' : 'Add API key'} onChange={e => { setKeys(k => ({ ...k, [id]: e.target.value })); setSaved(false); }} /></label>)}
    </div><p className="commander-muted">Use a speech or transcription model ID available to your provider account. Local dictation models are managed in app Settings → Voice.</p><button className="commander-btn" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save voice connections'}</button>{saved && <span role="status">Saved</span>}</>}
  </section>;
}
