import { useEffect, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { isAuthError, canReconnect } from "./reconnect";
import { agentDisplayName } from "./types";
import { ReconnectButton } from "./ReconnectButton";
import { checkAccountAuth, useAccountAuth } from "./accountAuth";

export function ThreadError({ error, onOpenAccounts, onContinue, continueDisabled, account, onRetry }: {
  error: string; onOpenAccounts?: () => void; onContinue?: () => void; continueDisabled?: boolean;
  /** Account that ran the thread; enables the Reconnect action for auth failures. */
  account?: { id: string; provider: string; name: string }; onRetry?: () => void;
}) {
  const [reconnected, setReconnected] = useState(false);
  // Include persisted errors from older app versions, not just newly raised errors.
  const signInError = /sign.in|sign in|signed out|not authenticated/i.test(error);
  const authFailure = isAuthError(error) && !!account && canReconnect(account.provider);
  const auth = useAccountAuth(account?.id ?? "");
  // A persisted/old auth error must not claim the sign-in is dead: verify live and let the shared auth state decide.
  useEffect(() => { if (authFailure && account) void checkAccountAuth(account.id); }, [authFailure, account?.id, error]);
  const restored = authFailure && (reconnected || auth.status === "valid");
  const expired = authFailure && !restored;
  const message = expired
    ? `${agentDisplayName(account)} sign-in expired.`
    : error === "Sign-in check timed out"
    ? "The agent CLI did not respond to the sign-in check within 10 seconds. Your sign-in status is unknown. Open Accounts and check the connection, then try your message again."
    : error;
  return <div role="alert" className="inline-error">
    <p>{message}</p>
    {expired && <ReconnectButton account={account.id} provider={account.provider} variant="default" onReconnected={() => setReconnected(true)} />}
    {restored && <p role="status">Reconnected.</p>}
    {restored && onRetry && <Button type="button" size="sm" onClick={onRetry}>Retry</Button>}
    {onContinue && <Button type="button" variant="outline" size="sm" disabled={continueDisabled} onClick={onContinue}>Continue</Button>}
    {signInError && onOpenAccounts && <Button type="button" variant="outline" size="sm" onClick={onOpenAccounts}>Open Accounts</Button>}
  </div>;
}
