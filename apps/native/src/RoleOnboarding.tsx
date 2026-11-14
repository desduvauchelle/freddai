import './satellite.css';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';

export function RoleOnboarding({ onLocal }: { onLocal: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function choose(satellite: boolean) {
    setBusy(true); setError('');
    try {
      if (satellite) await invoke('satellite_set_mode', { enabled: true });
      else { await invoke('satellite_finish_onboarding'); onLocal(); }
    } catch (e) { setError(String(e)); setBusy(false); }
  }
  return <main className="role-onboarding">
    <h1>How will you use this Mac?</h1>
    <p>Choose where your agents run. You can change this later in Settings.</p>
    <section><h2>Original Mac</h2><p>Set up projects and coding agents here. Other devices can connect to this Mac.</p><Button disabled={busy} onClick={() => void choose(false)}>Set up this Mac</Button></section>
    <section><h2>Satellite Mac</h2><p>Connect to an existing Freddai Mac. Use its projects and threads while your agents keep running there.</p><Button disabled={busy} onClick={() => void choose(true)}>Connect to my original Mac</Button></section>
    {error && <p role="alert">{error}</p>}
  </main>;
}
