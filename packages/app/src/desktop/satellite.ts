import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Resolves once per page load. A failed lookup means "not a satellite" (the command only exists in the native runtime). */
export const satelliteModePromise: Promise<boolean> = Promise.resolve()
  .then(() => (isTauri() ? invoke<boolean>('satellite_mode') : false))
  .then(value => value === true)
  .catch(() => false);

let resolved: boolean | null = null;
void satelliteModePromise.then(value => { resolved = value; });

/** null while loading, then whether this Mac runs as a satellite of another Mac. */
export function useSatelliteMode(): boolean | null {
  const [mode, setMode] = useState<boolean | null>(resolved);
  useEffect(() => {
    let live = true;
    void satelliteModePromise.then(value => { if (live) setMode(value); });
    return () => { live = false; };
  }, []);
  return mode;
}
