import "./satellite.css";
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Pairing } from '@freddai/app/mobile-pairing';
import { MobileApp } from '@freddai/app/mobile';
import { nativeCompanionClient } from '@freddai/app/mobile-client';

export function SatelliteApp() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="satellite-app">
    <header style={{ padding: '44px 20px 12px', display: 'flex', gap: 16, alignItems: 'center' }}>
      <strong>Mac satellite · Work runs on your paired Mac</strong>
      <button onClick={() => window.dispatchEvent(new Event('freddai:satellite-pair'))}>Connect to another Mac</button>
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        try { await invoke('satellite_set_mode', { enabled: false }); }
        catch (e) { setError(String(e)); setBusy(false); }
      }}>Use this Mac locally (restarts app)</button>
      {error && <span role="alert">{error}</span>}
    </header>
    <Pairing deviceKind="Mac">{pairAgain => <MobileApp client={nativeCompanionClient} onPairAgain={pairAgain} />}</Pairing>
  </div>;
}
