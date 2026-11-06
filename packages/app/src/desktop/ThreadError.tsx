import { Button } from "@freddai/ui/components/button";

export function ThreadError({ error, onOpenAccounts, onContinue, continueDisabled }: { error: string; onOpenAccounts?: () => void; onContinue?: () => void; continueDisabled?: boolean }) {
  // Include persisted errors from older app versions, not just newly raised errors.
  const signInError = /sign.in|sign in|signed out|not authenticated/i.test(error);
  const message = error === "Sign-in check timed out"
    ? "The agent CLI did not respond to the sign-in check within 10 seconds. Your sign-in status is unknown. Open Accounts and check the connection, then try your message again."
    : error;
  return <div role="alert" className="inline-error">
    <p>{message}</p>
    {onContinue && <Button type="button" variant="outline" size="sm" disabled={continueDisabled} onClick={onContinue}>Continue</Button>}
    {signInError && onOpenAccounts && <Button type="button" variant="outline" size="sm" onClick={onOpenAccounts}>Open Accounts</Button>}
  </div>;
}
