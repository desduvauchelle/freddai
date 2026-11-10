import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { Badge } from '@freddai/ui/components/badge';
import { Field, FieldLabel, FieldDescription } from '@freddai/ui/components/field';
import { Smartphone, Globe, ShieldCheck } from 'lucide-react';
type Devices = { setup?: string | null; code: string | null; expires: number | null; pending: { id: string; name: string } | null; devices: { id: string; name: string; pairedAt: number }[]; relay: string | null };
export function CompanionSettings({ native }: { native: boolean }) {
  const [mac, setMac] = useState(false);
  useEffect(() => { if (native) void invoke<boolean>('satellite_mode').then(() => setMac(true)).catch(() => {}); }, [native]);
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
  return <section aria-label="Devices & satellite settings">
    {mac && <section className="rounded-xl border p-5 space-y-3" aria-label="Mac satellite setup">
      <h2>Use this Mac as a satellite</h2>
      <p>Connect to Freddai on another Mac. Its projects, accounts, and coding agents stay there. The host Mac must remain awake and online. This Mac’s existing local work is preserved; background agents keep running.</p>
      <p>The app restarts into satellite setup. Pair using the host Mac’s Devices & satellite settings. You can return to local mode from the satellite Settings.</p>
      <Button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await invoke('satellite_set_mode', { enabled: true }); } catch (e) { setError(String(e)); setBusy(false); } }}>Set up Mac satellite (restarts app)</Button>
    </section>}
    {!native && <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">Phone pairing is available in the Mac app.</p>}
    <section aria-labelledby="companion-settings-heading" className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50"><Smartphone className="size-5" aria-hidden="true" /></div>
          <div className="space-y-1"><h2 id="companion-settings-heading">Pair a device</h2><p className="max-w-md text-sm text-muted-foreground">Access your Mac’s projects and conversations from Freddai on your device.</p></div>
        </div>
        <Button disabled={!native || busy} onClick={() => void action('begin')}>Pair device</Button>
      </div>
      <div className="border-t bg-muted/30 p-5">
        {state?.code && seconds > 0 ? <div role="status" className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">Copy Mac setup to your other device, then enter this code</p>
          {state.setup && <div className="space-y-2 text-left"><label htmlFor="companion-mac-setup" className="text-sm">Mac setup (public connection information)</label><textarea id="companion-mac-setup" className="w-full rounded-lg border bg-background p-3 text-xs" rows={3} readOnly value={state.setup} onFocus={e => e.target.select()} /><p className="text-xs text-muted-foreground">Transfer this text to your device using a method you trust. Paste setup only from your own Mac. You must still approve the phone below.</p></div>}
          <p aria-label={`Pairing code: ${state.code}`} className="mx-auto w-fit rounded-lg border bg-background px-5 py-3 font-mono text-3xl tracking-[0.25em] tabular-nums">{state.code}</p>
          <div className="flex flex-wrap items-center justify-center gap-3"><p className="text-xs text-muted-foreground">Expires in {seconds} seconds</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => void action('cancel')}>Cancel pairing</Button></div>
        </div> : <ol className="grid gap-4 text-sm sm:grid-cols-3">
          {["Connect your Mac and other device to the same local network.", "Click Pair device, then enter the six-digit code on your device.", "Approve the connection here on your Mac."].map((step, index) => <li key={step} className="flex items-start gap-2.5"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium">{index + 1}</span><span className="pt-0.5 text-muted-foreground">{step}</span></li>)}
        </ol>}
      </div>
      {state?.pending && <div role="status" className="space-y-3 border-t p-5">
        <div className="space-y-1"><h3>Allow “{state.pending.name}” to connect?</h3><p className="text-sm text-muted-foreground">Approve only if you just entered the code on your device.</p></div>
        <div className="flex gap-2"><Button disabled={busy} onClick={() => void action('approve', state.pending!.id)}>Approve device</Button><Button variant="outline" disabled={busy} onClick={() => void action('cancel')}>Deny</Button></div>
      </div>}
    </section>

    <section aria-labelledby="companion-devices-heading" className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b p-5"><h2 id="companion-devices-heading">Paired devices</h2><Badge variant="secondary">{state ? state.devices.length : '—'}</Badge></div>
      {state?.devices.length ? <ul className="divide-y">{state.devices.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex min-w-0 items-center gap-3"><Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><p className="break-words text-sm font-medium">{device.name}</p><p className="text-xs text-muted-foreground">Paired {new Date(device.pairedAt * 1000).toLocaleDateString()}</p></div></div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void action('revoke', device.id)}>Revoke access<span className="sr-only"> for {device.name}</span></Button>
      </li>)}</ul> : <div className="space-y-1 p-5"><p className="text-sm font-medium">{!native ? 'Open Freddai on your Mac to manage devices' : !state ? 'Loading paired devices…' : 'No devices paired yet'}</p><p className="text-sm text-muted-foreground">Approved devices will appear here. You can revoke their access at any time.</p></div>}
      <p className="flex items-start gap-2 border-t bg-muted/30 px-5 py-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Only devices you approve can access your projects and conversations or send agent instructions.</p>
    </section>

    <section aria-labelledby="companion-relay-heading" className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-start gap-3 border-b p-5"><Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="space-y-1"><h2 id="companion-relay-heading">Connect away from home</h2><p className="text-sm text-muted-foreground">Add a hosted Freddai relay for cellular and other Wi-Fi networks. Leave blank for local access only.</p></div></div>
      <form className="space-y-4 p-5" onSubmit={e => { e.preventDefault(); void action('relay', relay); }}>
        <Field><FieldLabel htmlFor="companion-relay">Internet relay address</FieldLabel><Input id="companion-relay" aria-describedby="companion-relay-help" type="url" placeholder="https://relay.example.com" value={relay} onChange={e => setRelay(e.target.value)} disabled={!native || busy} /><FieldDescription id="companion-relay-help">Messages are encrypted between your devices. Your Mac must remain awake and online.</FieldDescription></Field>
        <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!native || busy} type="submit">Save relay</Button><p className="max-w-md text-xs leading-relaxed text-muted-foreground">After changing the address, connect your paired device locally once to save it.</p></div>
      </form>
    </section>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
  </section>;
}
