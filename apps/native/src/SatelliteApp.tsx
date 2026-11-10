import './satellite.css';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
import { Pairing } from '@freddai/app/mobile-pairing';
import { MobileApp } from '@freddai/app/mobile';
import { nativeCompanionClient } from '@freddai/app/mobile-client';
import { useAppUpdate } from '@freddai/app/app-update';
import { updateBanner } from '@freddai/app/update-state';

export function SatelliteApp() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const updater = useAppUpdate(true, () => {}); // Companion drafts are saved as they change.
  const update = updateBanner(updater.state);
  const localButton = <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await invoke('satellite_set_mode', { enabled: false }); }
      catch (e) { setError(String(e)); setBusy(false); }
    }}>Use this Mac locally (restarts app)</Button>;
  const settings = <section className="satellite-settings" aria-label="This Mac">
    <h2>This Mac</h2><p>Satellite · Work runs on your original Mac.</p>
    <Button variant="outline" onClick={() => window.dispatchEvent(new Event('freddai:satellite-pair'))}>Connect to another Mac</Button>
    {localButton}
    <Button variant="ghost" disabled={updater.state.state === 'checking'} onClick={() => void updater.check()}>Check for updates</Button>
    {error && <p role="alert">{error}</p>}
  </section>;
  return <div className="satellite-app">
    <Pairing deviceKind="Mac" footer={<>{localButton}{error && <p role="alert">{error}</p>}</>}>{pairAgain => <MobileApp desktop client={nativeCompanionClient} onPairAgain={pairAgain} deviceSettings={settings} />}</Pairing>
    {(update || updater.notice) && <div className="satellite-update" role="status"><span>{update?.text || updater.notice}</span>{update?.action && <Button onClick={() => void updater.run(update.action!.kind)}>{update.action.label}</Button>}{updater.notice && <Button variant="ghost" onClick={updater.dismissNotice}>Dismiss</Button>}</div>}
  </div>;
}
