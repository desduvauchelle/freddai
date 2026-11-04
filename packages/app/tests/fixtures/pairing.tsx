import { createRoot } from 'react-dom/client';
import { Pairing } from '../../src/mobile/Pairing';
import { CompanionSettings } from '../../src/desktop/CompanionSettings';
import '@freddai/ui/styles.css';
import '../../src/mobile/mobile.css';
const desktop = new URLSearchParams(location.search).has('desktop');
let approved = false;
const devices = { code: null as string | null, expires: 0, pending: null as { id: string; name: string } | null, devices: [] as { id: string; name: string; pairedAt: number }[], relay: null };
// Synthetic UI boundary only: no device credentials, account records, or provider calls.
Object.assign(window, { approveSyntheticPairing: () => { approved = true; }, __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, string>) => {
  if (command === 'companion_pairing_status') return false;
  if (command === 'companion_pair') { if (args.code !== '123456') throw new Error('Incorrect or expired code'); return; }
  if (command === 'companion_pair_claim') return approved;
  if (command === 'companion_devices') return structuredClone(devices);
  if (command === 'companion_device_action') {
    if (args.action === 'begin') { devices.code = '123456'; devices.expires = Math.floor(Date.now() / 1000) + 180; devices.pending = { id: 'synthetic-device', name: 'Test iPhone' }; }
    if (args.action === 'approve') { devices.pending = null; devices.code = null; devices.devices = [{ id: 'synthetic-device', name: 'Test iPhone', pairedAt: Math.floor(Date.now() / 1000) }]; }
    if (args.action === 'revoke') devices.devices = [];
    if (args.action === 'cancel') { devices.code = null; devices.pending = null; }
    return structuredClone(devices);
  }
  throw new Error(`Unexpected command: ${command}`);
} } });
createRoot(document.getElementById('root')!).render(desktop ? <CompanionSettings native /> : <Pairing>{() => <p>Paired companion screen</p>}</Pairing>);
