import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Model } from './agent-selection';

/** Codex model catalog for one account (Claude uses fixed aliases, others have none). Errors are returned, never swallowed. */
export function useModelCatalog({ enabled, native, provider, accountId, loadModels }: { enabled: boolean; native: boolean; provider?: string; accountId?: string; loadModels?: () => Promise<Model[]> }) {
  const [catalog, setCatalog] = useState<{ key: string; models: Model[] }>(), [error, setError] = useState('');
  const loader = useRef(loadModels); loader.current = loadModels;
  const key = accountId || provider || '';
  const hasLoader = !!loadModels;
  useEffect(() => {
    if (!enabled || !native || provider !== 'codex' || (!hasLoader && !accountId)) return;
    let cancelled = false;
    setError('');
    Promise.resolve(loader.current ? loader.current() : invoke<Model[]>("account_models", { account: accountId })).then(models => {
      if (!cancelled) setCatalog({ key, models: Array.isArray(models) ? models : [] });
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [enabled, native, key, provider, hasLoader, accountId]);
  return { models: catalog?.key === key ? catalog.models : [] as Model[], error };
}
