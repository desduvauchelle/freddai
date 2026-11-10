import { limitingWindow, remainingPercent, resetCountdown } from '../desktop/usage';
import type { CompanionProductUsage } from './companion';

export type ProductUsageCard = {
  id: string; name: string; product: string; remaining: number | null;
  capacity: string; reset: string; stale: boolean; details: string;
};

export function productUsageCards(products: CompanionProductUsage[] = [], now = Date.now()): ProductUsageCard[] {
  return products.map(account => {
    const product = account.provider === 'codex' ? 'Codex' : account.provider === 'claude' ? 'Claude' : account.provider;
    const window = limitingWindow(account.usage?.windows || []);
    const remaining = remainingPercent(window?.used_percent);
    const stale = !!account.usage && now - account.usage.checked_at > 300000;
    const reset = resetCountdown(window?.resets_at, now).replace(/^(.*) until reset$/, 'Resets in $1');
    const capacity = remaining === null ? 'Unavailable' : `${Math.round(remaining)}% left`;
    const details = account.usage?.windows.map(w => {
      const left = remainingPercent(w.used_percent);
      return `${w.label}: ${left === null ? 'unavailable' : `${Math.round(left)}% left`}\n${w.resets_at ? `Resets ${new Date(w.resets_at * 1000).toLocaleString()}` : 'Reset time unavailable'}`;
    }).join('\n\n') || 'Usage could not be retrieved from this product. Check the connection on your Mac.';
    return { id: account.id, name: account.name, product, remaining, capacity, reset: remaining === null ? 'Check on your Mac' : stale ? 'Last known reading' : reset, stale,
      details: `${product} · ${account.name}\n\n${details}${stale ? '\n\nLast known reading. Waiting for an update from your Mac.' : ''}` };
  });
}
