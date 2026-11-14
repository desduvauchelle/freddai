import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
import { Pairing } from '@freddai/app/mobile-pairing';
import { DesktopApp } from '@freddai/app/desktop';

/** A satellite Mac shows the normal desktop UI; its commands are answered by the paired host Mac. */
export function SatelliteApp() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const footer = <>
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await invoke('satellite_set_mode', { enabled: false }); }
      catch (e) { setError(String(e)); setBusy(false); }
    }}>Use this Mac locally instead (restarts app)</Button>
    {error && <p role="alert">{error}</p>}
  </>;
  return <Pairing deviceKind="Mac" footer={footer}>{() => <DesktopApp />}</Pairing>;
}
