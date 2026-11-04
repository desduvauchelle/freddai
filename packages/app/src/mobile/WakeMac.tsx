import { useEffect, useRef, useState } from 'react';
import { Button } from '@freddai/ui/components/button';
import type { CompanionClient } from './companion';
/** Total time to keep checking for the Mac after sending the wake signal. */
export const WAKE_WAIT_MS = 30_000;
const POLL_MS = 3_000;
export type WakeState = { phase: 'idle' } | { phase: 'sending' } | { phase: 'waiting'; sent: number } | { phase: 'awake' } | { phase: 'failed'; message: string };
/** Sends the wake signal, then polls the Mac until it answers or the wait expires. Every failure carries a message. */
export async function wakeAndWait(client: CompanionClient, onState: (s: WakeState) => void, signal: AbortSignal, waitMs = WAKE_WAIT_MS, pollMs = POLL_MS): Promise<void> {
  if (!client.wake) { onState({ phase: 'failed', message: 'Wake is not available in this build.' }); return; }
  onState({ phase: 'sending' });
  let sent: number;
  try { sent = await client.wake(); } catch (e) { onState({ phase: 'failed', message: e instanceof Error ? e.message : String(e) }); return; }
  onState({ phase: 'waiting', sent });
  const deadline = Date.now() + waitMs;
  while (!signal.aborted && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    if (signal.aborted) return;
    const attempt = new AbortController();
    const timer = setTimeout(() => attempt.abort(), Math.max(1, deadline - Date.now()));
    try { await client.snapshot(attempt.signal); clearTimeout(timer); onState({ phase: 'awake' }); return; } catch { clearTimeout(timer); }
  }
  if (!signal.aborted) onState({ phase: 'failed', message: 'Your Mac did not wake within 30 seconds. Wake for network access must be on in its Battery settings and the Mac must be on this Wi-Fi network; a Mac asleep elsewhere cannot be woken by an app. Open Freddai on the Mac or press a key on it.' });
}
export function WakeMac({ client, onAwake }: { client: CompanionClient; onAwake?: () => void }) {
  const [state, setState] = useState<WakeState>({ phase: 'idle' }), [ready, setReady] = useState<boolean | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void client.hasWakeInfo?.().then(setReady, () => setReady(null)); return () => controller.current?.abort(); }, [client]);
  if (!client.wake) return null;
  const busy = state.phase === 'sending' || state.phase === 'waiting';
  const start = () => { controller.current?.abort(); const c = controller.current = new AbortController(); void wakeAndWait(client, s => { if (!c.signal.aborted) { setState(s); if (s.phase === 'awake') onAwake?.(); } }, c.signal); };
  return <div className="companion-wake">
    <Button variant="outline" disabled={busy || ready === false} onClick={start}>{busy ? 'Waking Mac…' : 'Wake Mac'}</Button>
    {ready === false && state.phase === 'idle' && <small>Connect to your Mac once on its Wi-Fi network so it can share its wake details.</small>}
    {state.phase === 'waiting' && <small role="status">Wake signal sent. Waiting up to 30 seconds for your Mac…</small>}
    {state.phase === 'awake' && <small role="status">Your Mac is awake.</small>}
    {state.phase === 'failed' && <small role="alert">{state.message}</small>}
  </div>;
}
