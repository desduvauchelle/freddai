import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Field, FieldContent, FieldLabel, FieldDescription } from "@freddai/ui/components/field";
import { Switch } from "@freddai/ui/components/switch";
type AwakeStatus = {
  settings: { whileWorking: boolean; whilePaired: boolean };
  state: { held: boolean; reason: string | null; error: string | null } | null;
  wakeForNetwork: boolean | null;
  wakeTargets: { interface: string; mac: string; ip: string | null }[];
  wakeError: string | null;
};
export function AwakeSettings({ native }: { native: boolean }) {
  const [status, setStatus] = useState<AwakeStatus>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!native) return;
    let active = true;
    const refresh = () => { void invoke<AwakeStatus>("awake_status").then(v => { if (active) setStatus(v); }).catch(e => { if (active) setError(String(e)); }); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [native]);
  async function update(patch: Partial<AwakeStatus["settings"]>) {
    if (!status) return;
    const next = { ...status.settings, ...patch };
    setBusy(true);
    try { setStatus(await invoke<AwakeStatus>("awake_set_settings", { whileWorking: next.whileWorking, whilePaired: next.whilePaired })); setError(""); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const s = status?.state;
  return <section aria-labelledby="awake-settings-heading">
    <h3 id="awake-settings-heading">Keep Mac awake</h3>
    <p className="capture-help">A sleeping Mac cannot run agents or answer your phone. Freddai can stop your Mac from going to sleep on its own; the display can still turn off. Closing the lid or choosing Sleep still sleeps the Mac.</p>
    <Field orientation="horizontal">
      <FieldContent><FieldLabel htmlFor="awake-working">Keep Mac awake while agents are working</FieldLabel><FieldDescription>Holds while a thread is running or waiting, messages are queued, or a schedule is about to run. Released when everything is idle.</FieldDescription></FieldContent>
      <Switch id="awake-working" checked={status?.settings.whileWorking ?? true} disabled={!native || busy || !status} onCheckedChange={v => void update({ whileWorking: v })} />
    </Field>
    <Field orientation="horizontal">
      <FieldContent><FieldLabel htmlFor="awake-paired">Keep Mac awake while a phone is paired</FieldLabel><FieldDescription>Keeps the phone reachable at all times. This uses noticeably more battery on a laptop; the display still sleeps normally.</FieldDescription></FieldContent>
      <Switch id="awake-paired" checked={status?.settings.whilePaired ?? false} disabled={!native || busy || !status} onCheckedChange={v => void update({ whilePaired: v })} />
    </Field>
    <p role="status" className="capture-help">{!native ? "Available in the Mac app." : !status ? "Checking…" : s?.held ? `Keeping your Mac awake: ${s.reason}.` : s ? "Not holding. Your Mac may sleep when idle." : "Background host has not reported yet. Keep-awake runs inside the background host, which restarts with Freddai."}</p>
    {s?.error && <p role="alert">Cannot keep the Mac awake: {s.error}</p>}
    <h3>Wake from your phone</h3>
    <p className="capture-help">The iPhone app can send a Wake-on-LAN signal when your Mac is unreachable. It only works while the phone is on the same network as the Mac.</p>
    <p role="status">{status?.wakeForNetwork === true ? "Wake for network access: on." : status?.wakeForNetwork === false ? "Wake for network access: off." : status ? "Wake for network access: could not be read." : ""}</p>
    {status?.wakeForNetwork === false && <p className="capture-help">Turn it on in System Settings &gt; Battery &gt; Options (laptop) or Energy (desktop): enable “Wake for network access”.</p>}
    {status?.wakeError && <p role="alert">Cannot read network details: {status.wakeError}</p>}
    {!!status?.wakeTargets.length && <p className="capture-help">Shared with paired phones: {status.wakeTargets.map(t => `${t.interface} ${t.mac}`).join(", ")}.</p>}
    <p className="capture-help">Limits: a fully asleep Mac is not reachable from the internet or cellular. Wake-on-LAN needs the phone on the same local network, and Wi-Fi wake generally depends on an always-on Apple TV or HomePod acting as a sleep proxy. Away from home, keep the Mac awake with the options above.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
