import { UsageRing } from "./UsageRing";
import { remainingPercent } from "./usage";
import { agentDisplayName } from "./types";
import { availableResets, resetExpiry, resetOutcome, type ResetCredits } from "./reset-credits";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { Code2, Terminal, RefreshCw, Settings2 } from "lucide-react";
import { resolveAccount, type Database } from "./types";

type Usage = {
  windows: { label: string; used_percent: number; resets_at: number | null }[];
  plan: string | null;
  checked_at: number;
  reset_credits?: ResetCredits | null;
};
type Result = { usage?: Usage; error?: string };
function resetLabel(seconds: number | null, now: number) {
  if (seconds === null) return "Reset time unavailable";
  const minutes = Math.ceil((seconds * 1000 - now) / 60000);
  if (minutes <= 0) return "Reset time reached · Refresh for current usage";
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  return `Resets in ${duration} · ${new Date(seconds * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;
}
export function AccountOverview({ db, native, onManage }: {
  db: Database; native: boolean; onManage: () => void;
}) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  const [confirmReset, setConfirmReset] = useState<{ account: string; credit: string } | null>(null);
  const [usingReset, setUsingReset] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const resetLock = useRef(false);
  const retryKeys = useRef<Record<string, string>>({});
  const request = useRef(0);
  async function useReset(account: string, credit: string) {
    if (resetLock.current) return;
    resetLock.current = true;
    setUsingReset(true);
    setResetMessage("");
    const retryId = JSON.stringify([account, credit]);
    const key = retryKeys.current[retryId] ||= crypto.randomUUID();
    try {
      const outcome = await invoke<string>("consume_reset", { account, creditId: credit, idempotencyKey: key });
      setResetMessage(resetOutcome(outcome));
      // Definitive non-redemptions may be retried later as a new logical attempt.
      if (outcome === "nothingToReset" || outcome === "noCredit") delete retryKeys.current[retryId];
      setConfirmReset(null);
      setRefresh(n => n + 1);
      window.dispatchEvent(new Event("freddai:usage-refresh"));
    } catch (e) {
      if (String(e).includes("Unknown host command")) {
        setResetMessage("The background host needs an update to use resets. Save your draft, quit Freddai (⌘Q), then reopen it from Applications and try again.");
      } else setResetMessage(`Could not confirm the reset: ${String(e)}. Refresh usage before retrying. A retry will reuse the same request key.`);
    } finally {
      resetLock.current = false;
      setUsingReset(false);
    }
  }
  const ids = db.accounts.map(a => a.id).join("|");
  useEffect(() => {
    const serial = ++request.current;
    let cancelled = false;
    setLoading(true);
    setResults({});
    void Promise.all(db.accounts.map(async account => {
      let result: Result;
      if (!native) result = { error: "Open the desktop app to retrieve account usage." };
      else {
        try { result = { usage: await invoke<Usage>("account_usage", { account: account.id }) }; }
        catch (e) { result = { error: String(e) }; }
      }
      if (!cancelled && request.current === serial)
        setResults(previous => ({ ...previous, [account.id]: result }));
    })).finally(() => {
      if (!cancelled && request.current === serial) { setLoading(false); setNow(Date.now()); }
    });
    return () => { cancelled = true; };
  }, [ids, native, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return <div className="account-overview">
    <div className="account-overview-tools">
      <span role="status">{loading ? "Updating usage…" : "Usage reported by your providers"}</span>
      <Button variant="ghost" size="sm" disabled={loading || usingReset || !native || !db.accounts.length} onClick={() => setRefresh(n => n + 1)}>
        <RefreshCw size={13}/> Refresh
      </Button>
    </div>
    {resetMessage && <p role="status" className="setup-note">{resetMessage}</p>}
    {!db.accounts.length && <p className="setup-note">No accounts yet. Add an account to see its usage here.</p>}
    <div className="account-overview-list">
      {db.accounts.map(account => {
        const result = results[account.id];
        const usage = result?.usage;
        const ProviderIcon = account.provider === "codex" ? Code2 : Terminal;
        return <section className="account-usage-card" key={account.id} aria-label={`${agentDisplayName(account)} usage`}>
          <div className="account-usage-heading">
            <span className="account-provider-icon" style={{ color: account.color }}><ProviderIcon size={18}/></span>
            <div><strong>{agentDisplayName(account)}</strong><span>{usage?.plan || "Usage"}</span></div>
            {resolveAccount(db) === account.id && <span className="account-default">Default</span>}
          </div>
          {usage ? <>
            {usage.windows.map((window, index) => {
              const remaining = remainingPercent(window.used_percent);
              return <div className="account-usage-window" key={index}>
                <UsageRing remaining={remaining} color={account.color} size={46}
                  label={`${agentDisplayName(account)}, ${window.label}, remaining capacity`}/>
                <div className="account-usage-window-copy">
                  <div><span>{window.label}</span><strong>{remaining === null ? "Remaining capacity unavailable" : `${Math.round(remaining)}% left`}</strong></div>
                  <p>{resetLabel(window.resets_at, now)}</p>
                </div>
              </div>;
            })}
            {!usage.windows.length && <p className="capture-help">Usage limits unavailable</p>}
            {account.provider === "codex" && <div className="account-reset-credits">
              <strong>Banked free resets</strong>
              {usage.reset_credits ? <>
                <p>{usage.reset_credits.available_count} available</p>
                {!!availableResets(usage.reset_credits).length && <ul>
                  {availableResets(usage.reset_credits).map(credit => <li key={credit.id}>
                    <span>{credit.title || "Rate-limit reset"}</span>
                    <span>{resetExpiry(credit, now)}</span>
                    {confirmReset?.account === account.id && confirmReset.credit === credit.id ?
                      <div className="reset-confirm" role="group" aria-label={`Use reset for ${agentDisplayName(account)}`}>
                        <p>Use this banked reset for {agentDisplayName(account)}? This consumes one reset if a usage limit is eligible.</p>
                        <Button size="sm" disabled={usingReset || loading} onClick={() => void useReset(account.id, credit.id)}>{usingReset ? "Using reset…" : "Confirm use reset"}</Button>
                        <Button size="sm" variant="ghost" disabled={usingReset} onClick={() => setConfirmReset(null)}>Cancel</Button>
                      </div> :
                      <Button size="sm" variant="outline" disabled={!native || loading || usingReset || usage.reset_credits!.available_count === 0 || (credit.expires_at !== null && credit.expires_at * 1000 <= now)}
                        aria-label={`Use ${credit.title || "reset"} for ${agentDisplayName(account)}`}
                        onClick={() => { setResetMessage(""); setConfirmReset({ account: account.id, credit: credit.id }); }}>Use reset</Button>}
                  </li>)}
                </ul>}
                {usage.reset_credits.available_count > availableResets(usage.reset_credits).length &&
                  <p className="capture-help">Expiry details unavailable for {usage.reset_credits.available_count - availableResets(usage.reset_credits).length} reset(s).</p>}
              </> : <p className="capture-help">Reset balance and expiry dates unavailable from this account or CLI.</p>}
            </div>}
            <small>Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone} · Updated {new Date(usage.checked_at).toLocaleTimeString([], { timeZoneName: "short" })}</small>
          </> : <div className="account-usage-unavailable" role="status">
            <strong>{result ? "Usage unavailable" : "Loading usage…"}</strong>
            <p>{result?.error || "Retrieving usage and reset times."}</p>
            {result && <span>Reset time unavailable</span>}
          </div>}
        </section>;
      })}
    </div>
    <div className="account-overview-footer">
      <span>Add accounts, sign in, and change defaults in account management.</span>
      <Button variant="outline" onClick={onManage}><Settings2 size={14}/> Manage accounts</Button>
    </div>
  </div>;
}
