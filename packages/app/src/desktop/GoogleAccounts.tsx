import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Badge } from "@freddai/ui/components/badge";
import { Field, FieldLabel, FieldDescription } from "@freddai/ui/components/field";
import { KeyRound, Link2, TriangleAlert } from "lucide-react";
import { GOOGLE_SERVICES, SERVICE_LABEL, errorText, formatIsoWhen } from "../google";
import type { GoogleAccount, GoogleCommand, GoogleConfig, GoogleConnectStart, GoogleConnectStatus, GoogleHostSupport } from "../google";

/** Loads the connected Google accounts. Failures stay in `error` so the panel can show them verbatim. */
export function useGoogleAccounts(command: GoogleCommand, enabled: boolean) {
  const [accounts, setAccounts] = useState<GoogleAccount[] | null>(null), [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { const result = await command("google_accounts", {}) as { accounts: GoogleAccount[] }; setAccounts(result.accounts); setError(""); }
    catch (e) { setError(errorText(e)); }
  }, [command]);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  return { accounts, error, reload };
}

/** Asks the running background host whether it knows the google_* operations; "outdated" means it predates them. */
export function useGoogleHostSupport(command: GoogleCommand, enabled: boolean): { state: "checking" | "supported" | "outdated"; error: string } {
  const [state, setState] = useState<"checking" | "supported" | "outdated">("checking"), [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    command("google_capability", {}).then(value => { if (active) setState((value as GoogleHostSupport).supported ? "supported" : "outdated"); })
      .catch(e => {
        if (!active) return;
        const text = errorText(e);
        // A host or Mac app that does not know the probe itself is exactly the outdated case; anything else is shown and the controls stay.
        if (/unknown/i.test(text)) setState("outdated"); else { setError(text); setState("supported"); }
      });
    return () => { active = false; };
  }, [enabled, command]);
  return { state, error };
}

export function GoogleHostOutdatedNotice({ message }: { message: string }) {
  return <section role="alert" aria-labelledby="google-host-outdated-heading" className="flex items-start gap-3 rounded-xl border border-amber-500/60 bg-amber-500/10 p-5 text-sm">
    <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
    <div className="min-w-0 space-y-1"><h2 id="google-host-outdated-heading">Background host needs a restart</h2><p className="break-words text-muted-foreground">{message}</p></div>
  </section>;
}

const STEPS = [
  "Create a project in the Google Cloud console.",
  "Enable the Gmail, Google Calendar and Google Drive APIs for it.",
  "Configure the OAuth consent screen with the External user type.",
  "Publish the app to “In production”. While it is in Testing, Google signs you out every 7 days.",
  "Create an OAuth client of type “Desktop app”.",
  "Paste its client ID and client secret here.",
];

export function GoogleSetup({ command, native, config, onChange }: { command: GoogleCommand; native: boolean; config: GoogleConfig | null; onChange: (config: GoogleConfig) => void }) {
  const [clientId, setClientId] = useState(""), [secret, setSecret] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { if (config && !loaded.current) { loaded.current = true; setClientId(config.clientId || ""); } }, [config]);
  const dirty = !!config && (clientId.trim() !== (config.clientId || "") || !!secret);
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await command("google_config_set", { clientId: clientId.trim(), ...(secret ? { clientSecret: secret } : {}) }) as GoogleConfig;
      onChange(result); setClientId(result.clientId || ""); setSecret(""); setSaved(true);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section aria-labelledby="google-setup-heading" className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
    <div className="flex items-start gap-3 border-b p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50"><KeyRound className="size-5" aria-hidden="true" /></div>
      <div className="space-y-1"><h2 id="google-setup-heading">Google setup</h2><p className="max-w-xl text-sm text-muted-foreground">Freddai signs in to Google with your own Google Cloud OAuth client. Sign-in tokens stay on this computer.</p></div>
    </div>
    <form className="space-y-4 p-5" onSubmit={e => { e.preventDefault(); void save(); }}>
      <Field><FieldLabel htmlFor="google-client-id">Client ID</FieldLabel><Input id="google-client-id" autoComplete="off" spellCheck={false} placeholder="123456789-abc.apps.googleusercontent.com" value={clientId} onChange={e => { setClientId(e.target.value); setSaved(false); }} disabled={!native || busy} /></Field>
      <Field><FieldLabel htmlFor="google-client-secret">Client secret</FieldLabel><Input id="google-client-secret" type="password" autoComplete="off" aria-describedby="google-secret-help" placeholder={config?.hasClientSecret ? "Leave blank to keep the saved secret" : "GOCSPX-…"} value={secret} onChange={e => { setSecret(e.target.value); setSaved(false); }} disabled={!native || busy} />
        <FieldDescription id="google-secret-help">{config?.hasClientSecret ? "A client secret is saved. Leave this blank to keep it." : "No client secret saved yet."}</FieldDescription></Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={!native || busy || !clientId.trim() || (!!config && !dirty)}>Save</Button>
        {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">{config?.secretStorage === "file" ? "The client secret is stored in a local file on this computer, because no system keychain is available." : "The client secret is stored in your system Keychain and never leaves this computer."}</p>
    </form>
    <details className="border-t bg-muted/30 px-5 py-4 text-sm">
      <summary className="cursor-pointer font-medium">How to get these</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">{STEPS.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Google shows an “unverified app” warning when you connect. Choose Advanced, continue, and tick every Gmail, Calendar and Drive box.</p>
    </details>
  </section>;
}

function ServiceChips({ account }: { account: GoogleAccount }) {
  return <div className="flex flex-wrap gap-1.5" aria-label={`Services for ${account.email}`}>
    {GOOGLE_SERVICES.map(service => account.services.includes(service)
      ? <Badge key={service} variant="secondary">{SERVICE_LABEL[service]}</Badge>
      : <Badge key={service} variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400" title={`${SERVICE_LABEL[service]} access was not granted`}><TriangleAlert className="size-3" aria-hidden="true" />{SERVICE_LABEL[service]} not granted</Badge>)}
  </div>;
}

type Flow = { id: string };

/** Accounts list. Connecting needs the sign-in redirect to land on the Mac, so `connect` is desktop-only. */
export function GoogleAccountsPanel({ command, native, accounts, error: loadError, onChanged, connect }: {
  command: GoogleCommand; native: boolean; accounts: GoogleAccount[] | null; error: string; onChanged: () => Promise<void>;
  connect?: { canConnect: boolean; blockedReason: string; openExternal: (url: string) => Promise<void>; pollMs?: number };
}) {
  const [flow, setFlow] = useState<Flow | null>(null), [authUrl, setAuthUrl] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [removing, setRemoving] = useState("");
  const token = useRef(0), latest = useRef({ command, onChanged });
  latest.current = { command, onChanged };
  const pollMs = connect?.pollMs ?? 1000;
  useEffect(() => () => { token.current += 1; }, []);
  useEffect(() => {
    if (!flow) return;
    const mine = ++token.current;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await latest.current.command("google_connect_status", { flowId: flow.id }) as GoogleConnectStatus;
        if (token.current !== mine || status.state === "pending") return;
        clearInterval(timer); setFlow(null); setAuthUrl("");
        if (status.state === "connected") { setNotice(`Connected ${status.email || "Google account"}.`); await latest.current.onChanged(); }
        else setError(status.error || (status.state === "expired" ? "Google sign-in expired before it finished." : "Google sign-in failed."));
      } catch (e) {
        if (token.current !== mine) return;
        clearInterval(timer); setFlow(null); setAuthUrl(""); setError(errorText(e));
      } finally { inFlight = false; }
    }, pollMs);
    return () => { clearInterval(timer); };
  }, [flow, pollMs]);
  async function start() {
    if (!connect) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const started = await command("google_connect_start", {}) as GoogleConnectStart;
      setFlow({ id: started.flowId }); setAuthUrl(started.authUrl);
      try { await connect.openExternal(started.authUrl); }
      catch (e) { setError(`Could not open your browser: ${errorText(e)} Open the sign-in link below yourself.`); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function cancel() { token.current += 1; setFlow(null); setAuthUrl(""); setNotice("Sign-in cancelled."); }
  async function disconnect(email: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await command("google_disconnect", { email }) as { ok: boolean; revokeError?: string };
      setRemoving("");
      if (result.revokeError) setError(`${email} was disconnected from Freddai, but Google did not revoke its access: ${result.revokeError}`);
      else setNotice(`Disconnected ${email}.`);
      await onChanged();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const disabled = !native || busy;
  return <section aria-labelledby="google-accounts-heading" className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
      <div className="flex items-center gap-3"><h2 id="google-accounts-heading">Google accounts</h2><Badge variant="secondary">{accounts ? accounts.length : "—"}</Badge></div>
      {connect && <Button disabled={disabled || !!flow || !connect.canConnect} onClick={() => void start()}><Link2 aria-hidden="true" />Connect Google account</Button>}
    </div>
    {connect && !connect.canConnect && <p className="border-b bg-muted/30 px-5 py-3 text-xs leading-relaxed text-muted-foreground">{connect.blockedReason}</p>}
    {flow && <div role="status" className="space-y-3 border-b bg-muted/30 p-5">
      <div className="space-y-1"><p className="text-sm font-medium">Waiting for Google sign-in…</p><p className="text-sm text-muted-foreground">Finish signing in in your browser. This page updates when Google sends you back.</p></div>
      {authUrl && <p className="break-all text-xs text-muted-foreground">Browser did not open? <a className="underline" href={authUrl} target="_blank" rel="noreferrer">Open the sign-in link</a></p>}
      <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
    </div>}
    {loadError && <p role="alert" className="border-b border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{loadError}</p>}
    {error && <p role="alert" className="border-b border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="border-b bg-muted/30 px-5 py-3 text-sm text-muted-foreground">{notice}</p>}
    {accounts?.length ? <ul className="divide-y">{accounts.map(account => <li key={account.email} className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5"><p className="break-words text-sm font-medium">{account.email}</p>{account.name && <p className="break-words text-sm text-muted-foreground">{account.name}</p>}<p className="text-xs text-muted-foreground">Connected {formatIsoWhen(account.connectedAt) || "recently"}</p></div>
        <div className="flex flex-wrap gap-2">
          {connect && <Button variant="outline" size="sm" disabled={disabled || !!flow || !connect.canConnect} onClick={() => void start()}>Reconnect<span className="sr-only"> {account.email}</span></Button>}
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setRemoving(account.email)}>Disconnect<span className="sr-only"> {account.email}</span></Button>
        </div>
      </div>
      <ServiceChips account={account} />
      {account.status === "needs_reauth" && <p role="status" className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Needs reconnecting. Google no longer accepts the saved sign-in.{!connect && " Reconnect it in Freddai on your Mac."}</p>}
      {account.status === "error" && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{account.lastError || "Google returned an error."}</span></p>}
      {removing === account.email && <div role="alert" className="space-y-3 rounded-lg border bg-muted/40 p-4">
        <p className="text-sm">Disconnect {account.email}? Freddai will ask Google to revoke its access. Triggers that use this account stop firing.</p>
        <div className="flex flex-wrap gap-2"><Button variant="destructive" size="sm" disabled={disabled} onClick={() => void disconnect(account.email)}>Disconnect account</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving("")}>Keep account</Button></div>
      </div>}
    </li>)}</ul> : <div className="space-y-1 p-5"><p className="text-sm font-medium">{!native ? "Open Freddai on your Mac to manage Google accounts" : !accounts ? (loadError ? "Accounts could not be loaded" : "Loading accounts…") : "No Google accounts connected yet"}</p>{accounts && <p className="text-sm text-muted-foreground">{connect ? "Connect an account to let triggers react to your email, calendar and Drive." : "Connect accounts in Freddai on your Mac."}</p>}</div>}
  </section>;
}
