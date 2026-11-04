import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
type Devices = { code: string | null; expires: number | null; pending: { id: string; name: string } | null; devices: { id: string; name: string; pairedAt: number }[]; relay: string | null };
export function CompanionSettings({ native }: { native: boolean }) {
  const [state, setState] = useState<Devices>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [relay, setRelay] = useState(''), [loaded, setLoaded] = useState(false), [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!native) return;
    let active = true;
    const refresh = () => { void invoke<Devices>('companion_devices').then(value => { if (active) { setState(value); setTick(Date.now()); } }).catch(e => { if (active) setError(String(e)); }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [native]);
  useEffect(() => { if (state && !loaded) { setRelay(state.relay || ''); setLoaded(true); } }, [state, loaded]);
  async function action(action: string, id = '') {
    setBusy(true); setError('');
    try { setState(await invoke<Devices>('companion_device_action', { action, id })); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const seconds = Math.max(0, (state?.expires || 0) - Math.floor(tick / 1000));
  return <section aria-labelledby="companion-settings-heading">
    <h2 id="companion-settings-heading">Phone pairing</h2>
    <p className="capture-help">Click Pair phone to display a six-digit code, then enter it on your phone. Pair once on the same local network. Only phones you approve can access your projects and conversations or send agent instructions.</p>
    <Button variant="outline" disabled={!native || busy} onClick={() => void action('begin')}>Pair phone</Button>
    {state?.code && seconds > 0 && <div role="status"><p>Enter this code in Freddai on your phone:</p><p style={{ fontSize: 28, letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums' }}>{state.code}</p><p>Expires in {seconds} seconds.</p><Button variant="ghost" disabled={busy} onClick={() => void action('cancel')}>Cancel pairing</Button></div>}
    {state?.pending && <div role="status"><p>Allow “{state.pending.name}” to connect? Approve only if you just entered the code on your phone.</p><Button disabled={busy} onClick={() => void action('approve', state.pending!.id)}>Approve phone</Button><Button variant="outline" disabled={busy} onClick={() => void action('cancel')}>Deny</Button></div>}
    {!!state?.devices.length && <ul>{state.devices.map(device => <li key={device.id}>{device.name} · paired {new Date(device.pairedAt * 1000).toLocaleDateString()} <Button variant="ghost" disabled={busy} onClick={() => void action('revoke', device.id)}>Revoke access</Button></li>)}</ul>}
    <form onSubmit={e => { e.preventDefault(); void action('relay', relay); }}>
      <label htmlFor="companion-relay">Internet relay address</label>
      <Input id="companion-relay" type="url" placeholder="https://relay.example.com" value={relay} onChange={e => setRelay(e.target.value)} disabled={!native || busy} />
      <p className="capture-help">Use your hosted Freddai relay for cellular and other Wi-Fi networks. Messages are encrypted between your devices. After changing this address, connect your paired phone locally once to save it. Your Mac must remain awake and online. Leave blank for local access only.</p>
      <Button variant="outline" disabled={!native || busy} type="submit">Save relay</Button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
