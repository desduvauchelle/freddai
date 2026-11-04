import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Pairing } from '@freddai/app/mobile-pairing';
import { MobileApp } from '@freddai/app/mobile';
import { nativeCompanionClient } from '@freddai/app/mobile-client';
import '@freddai/ui/styles.css';

const root = createRoot(document.getElementById('root')!);
// Simulator-only fixture mode: VITE_COMPANION_FIXTURE=1 at build time. Replaced by `false` in device builds, so the dynamic import is dead code and never bundled.
if (import.meta.env.VITE_COMPANION_FIXTURE === '1') {
  void import('@freddai/app/mobile-fixture').then(({ createFixtureClient }) => {
    const client = createFixtureClient();
    root.render(<StrictMode><MobileApp client={client} onPairAgain={() => {}} /></StrictMode>);
  });
} else {
  root.render(<StrictMode><Pairing>{pairAgain => <MobileApp client={nativeCompanionClient} onPairAgain={pairAgain} />}</Pairing></StrictMode>);
}
