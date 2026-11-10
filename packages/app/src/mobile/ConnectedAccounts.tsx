import { Smartphone } from 'lucide-react';
import { GoogleAccountsPanel, GoogleHostOutdatedNotice, useGoogleAccounts, useGoogleHostSupport } from '../desktop/GoogleAccounts';
import { GoogleTriggersPanel, useGoogleTriggers } from '../desktop/GoogleTriggers';
import type { DeliveryData } from '../desktop/DeliveryControls';
import { GOOGLE_HOST_OUTDATED_NOTICE_MOBILE } from '../google';
import type { GoogleCommand } from '../google';

/**
 * Companion view of Google accounts and triggers. Accounts can only be connected, reconnected or
 * configured on the Mac, because Google's sign-in redirect lands there.
 */
export function ConnectedAccounts({ command, connected, db }: { command: GoogleCommand; connected: boolean; db: DeliveryData }) {
  const support = useGoogleHostSupport(command, connected);
  const ready = connected && support.state === 'supported';
  const { accounts, error: accountsError, reload: reloadAccounts } = useGoogleAccounts(command, ready);
  const { triggers, error: triggersError, reload: reloadTriggers } = useGoogleTriggers(command, ready);
  if (connected && support.state === 'outdated') return <div className="companion-google space-y-4"><GoogleHostOutdatedNotice message={GOOGLE_HOST_OUTDATED_NOTICE_MOBILE} /></div>;
  return <div className="companion-google space-y-4">
    <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"><Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Connect Google accounts and edit the Google client ID and secret in Freddai on your Mac. Google’s sign-in returns to the Mac, so it cannot finish from here.</p>
    {support.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{support.error}</p>}
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to your Mac to manage connected accounts.</p>}
    <GoogleAccountsPanel command={command} native={connected} accounts={accounts} error={accountsError} onChanged={async () => { await Promise.all([reloadAccounts(), reloadTriggers()]); }} />
    <GoogleTriggersPanel command={command} native={connected} accounts={accounts} db={db} triggers={triggers} error={triggersError} reload={reloadTriggers} />
  </div>;
}
