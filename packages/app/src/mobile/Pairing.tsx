import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
export function Pairing({ children, deviceKind = "Phone" }: { deviceKind?: "Phone" | "Mac"; children: (pairAgain: () => void) => ReactNode }) {
  const [paired, setPaired] = useState<boolean>(), [code, setCode] = useState(''), [name, setName] = useState(deviceKind === 'Mac' ? 'My satellite Mac' : /Android/i.test(navigator.userAgent) ? 'My Android' : 'My iPhone');
  const [setup, setSetup] = useState(''), [waiting, setWaiting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (deviceKind !== 'Mac') return;
    const reconnect = () => { setPaired(false); setWaiting(false); setCode(''); setSetup(''); setError(''); };
    window.addEventListener('freddai:satellite-pair', reconnect);
    return () => window.removeEventListener('freddai:satellite-pair', reconnect);
  }, [deviceKind]);
  useEffect(() => { void invoke<boolean>('companion_pairing_status').then(setPaired).catch(e => setError(String(e))); }, []);
  useEffect(() => {
    if (!waiting) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const ready = await invoke<boolean>('companion_pair_claim'); if (!active) return; if (ready) { localStorage.setItem('freddai.companion.outboxScope', crypto.randomUUID()); setWaiting(false); setPaired(true); return; } }
      catch (e) { if (active) { setWaiting(false); setError(String(e)); } return; }
      if (active) timer = setTimeout(poll, 1500);
    }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [waiting]);
  if (paired) return <>{children(() => { setPaired(false); setCode(''); setError(''); })}</>;
  return <main className="companion companion-pairing">
    <h1>Connect to your Mac</h1><p>On your Mac, open Freddai → Settings → Pair phone. Copy the Mac setup to this device and enter its six-digit code here, then approve the connection on your Mac.</p>
    <p>For this first connection, keep both devices on the same local network.</p>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await invoke('companion_pair', { code, name, setup: setup || null }); setWaiting(true); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>
      <label htmlFor="pair-mac-setup">Mac setup</label><textarea id="pair-mac-setup" aria-describedby="pair-mac-help" rows={3} value={setup} onChange={e => setSetup(e.target.value)} disabled={busy || waiting} placeholder="Paste Mac setup" autoCapitalize="off" autoCorrect="off" spellCheck={false} /><p id="pair-mac-help">Copy this from your own Mac’s Pair phone settings. When reconnecting to the same Mac, you can leave it blank.</p>
      <label htmlFor="pair-device-name">{deviceKind === 'Mac' ? 'Satellite Mac name' : 'Phone name'}</label><Input id="pair-device-name" maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy || waiting} />
      <label htmlFor="pair-device-code">Pairing code</label><Input id="pair-device-code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy || waiting} />
      <Button type="submit" disabled={paired === undefined || code.length !== 6 || !name.trim() || busy || waiting}>{busy ? 'Connecting…' : 'Connect'}</Button>
    </form>
    {waiting && <p role="status">Waiting for approval on your Mac…</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="ghost" onClick={() => { setWaiting(false); setCode(''); setError(''); void invoke<boolean>('companion_pairing_status').then(setPaired).catch(e => setError(String(e))); }}>Back</Button>
  </main>;
}
