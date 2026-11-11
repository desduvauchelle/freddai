import { usageErrorSummary, usageSummary, type UsageLine } from '../desktop/usage';
import type { CompanionProductUsage } from './companion';

export type ProductUsageCard = {
  id: string; name: string; product: string; remaining: number | null;
  capacity: string; reset: string; stale: boolean; details: string;
  /** e.g. "61% left · resets 23:20"; null when the account has no session window. */
  session: string | null; sessionRemaining: number | null;
  /** e.g. "88% left · resets Thu 13:00"; null when the account has no weekly window. */
  weekly: string | null; weeklyRemaining: number | null;
  /** Short reason when there is no usable usage reading (e.g. "Sign-in expired · reconnect"); null when usage is present. */
  status: string | null;
};

const lineText = (line: UsageLine | null) => line && line.remaining !== null ? `${Math.round(line.remaining)}% left · ${line.resetText}` : null;

export function productUsageCards(products: CompanionProductUsage[] = [], now = Date.now()): ProductUsageCard[] {
  return products.map(account => {
    const product = account.provider === 'codex' ? 'Codex' : account.provider === 'claude' ? 'Claude' : account.provider;
    const summary = usageSummary(account.usage?.windows || [], now);
    const { limiting } = summary;
    const remaining = limiting?.remaining ?? null;
    const stale = !!account.usage && (!!account.error || now - account.usage.checked_at > 300000);
    const status = remaining === null ? usageErrorSummary(account.error, account.provider) : null;
    const reset = limiting ? limiting.resetText.replace(/^resets? /, 'Resets ') : '';
    const capacity = status ?? `${Math.round(remaining as number)}% left`;
    const lines = summary.lines.map(l => `${l.label} · ${l.remaining === null ? 'unavailable' : `${Math.round(l.remaining)}% left`} · ${l.resetText}`).join('\n')
      || 'Usage could not be retrieved from this product. Check the connection on your Mac.';
    return { id: account.id, name: account.name, product, remaining, capacity,
      reset: remaining === null ? 'Check on your Mac' : stale ? 'Last known reading' : reset, stale,
      session: lineText(summary.session), sessionRemaining: summary.session?.remaining ?? null,
      weekly: lineText(summary.weekly), weeklyRemaining: summary.weekly?.remaining ?? null,
      status,
      details: `${product} · ${account.name}\n\n${lines}${account.error ? `\n\n${account.error}` : ''}${stale ? '\n\nLast known reading. Waiting for an update from your Mac.' : ''}` };
  });
}
