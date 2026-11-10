import { useCallback, useEffect, useState } from "react";
import "./GoogleAccounts.css";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Badge } from "@freddai/ui/components/badge";
import { Switch } from "@freddai/ui/components/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@freddai/ui/components/select";
import { TriangleAlert, Zap } from "lucide-react";
import { DeliveryRouting, DeliveryTask, type DeliveryData } from "./DeliveryControls";
import { EVENT_FIELDS, EVENT_LABEL, EVENT_SERVICE, SERVICE_LABEL, errorText, formatWhen } from "../google";
import type { GoogleAccount, GoogleCommand, GoogleTrigger, GoogleTriggerEvent } from "../google";

const EVENTS = Object.keys(EVENT_LABEL) as GoogleTriggerEvent[];
const FULL_ACCESS_WARNING = "Full access lets this agent act without asking. Trigger runs are started by content other people wrote (emails, invites, shared files), which can try to instruct the agent. Leave this off unless the trigger only reads.";
const eligible = (accounts: GoogleAccount[], event: GoogleTriggerEvent) => accounts.filter(a => a.services.includes(EVENT_SERVICE[event]));

export function useGoogleTriggers(command: GoogleCommand, enabled: boolean) {
  const [triggers, setTriggers] = useState<GoogleTrigger[] | null>(null), [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { const result = await command("google_triggers", {}) as { triggers: GoogleTrigger[] }; setTriggers(result.triggers); setError(""); }
    catch (e) { setError(errorText(e)); }
  }, [command]);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  return { triggers, error, reload };
}

function blank(db: DeliveryData, accounts: GoogleAccount[]): GoogleTrigger {
  const event: GoogleTriggerEvent = "gmail_message_received";
  const agent = db.accounts[0]?.id || "";
  return {
    id: "", name: "", google_account: (eligible(accounts, event)[0] || accounts[0])?.email || "", event, filter: null, resource: null, enabled: true,
    project: db.projects[0]?.id || "", account: agent, routing: "fixed", new_chat: true, thread: null, notifications: "important", prompt: "",
    options: { worktree: false, permission_mode: "ask" },
  };
}

export function GoogleTriggersPanel({ command, native, accounts, db, triggers, error: loadError, reload }: {
  command: GoogleCommand; native: boolean; accounts: GoogleAccount[] | null; db: DeliveryData; triggers: GoogleTrigger[] | null; error: string; reload: () => Promise<void>;
}) {
  const [form, setForm] = useState<GoogleTrigger | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState("");
  const list = accounts || [];
  const noAccounts = !!accounts && !accounts.length;
  const update = (patch: Partial<GoogleTrigger>) => setForm(f => f && { ...f, ...patch });
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await fn(); await reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.prompt.trim()) throw new Error("Add a name and task prompt first.");
    if (!form.google_account) throw new Error("Choose the Google account this trigger watches.");
    if (form.new_chat === false && !form.thread) throw new Error("Choose the thread this trigger should run in.");
    const clean = (value: string | null) => (value || "").trim() || null;
    await command("google_trigger_save", { trigger: { ...form, name: form.name.trim(), filter: clean(form.filter), resource: form.event === "gmail_message_received" ? null : clean(form.resource) } });
    setForm(null);
  }
  const fields = form ? EVENT_FIELDS[form.event] : null;
  const accountChoices = form ? eligible(list, form.event) : [];
  const stale = form && form.google_account && !accountChoices.some(a => a.email === form.google_account);
  return <section aria-labelledby="google-triggers-heading" className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
      <div className="flex items-center gap-3"><h2 id="google-triggers-heading">Triggers</h2><Badge variant="secondary">{triggers ? triggers.length : "—"}</Badge></div>
      {!form && <Button variant="outline" disabled={!native || busy || !list.length} onClick={() => { setError(""); setForm(blank(db, list)); }}><Zap aria-hidden="true" />Add trigger</Button>}
    </div>
    <p className="border-b bg-muted/30 px-5 py-3 text-xs leading-relaxed text-muted-foreground">{noAccounts ? "Connect a Google account first. Triggers watch an account and start agent work when something changes." : "A trigger starts agent work when an email arrives, a calendar event changes or a Drive file changes. Freddai checks while this Mac is awake."}</p>
    {loadError && <p role="alert" className="border-b border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{loadError}</p>}
    {error && <p role="alert" className="border-b border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
    {form && fields ? <form className="google-trigger-form schedule-manager p-5" aria-label={form.id ? "Edit trigger" : "New trigger"} onSubmit={e => { e.preventDefault(); void act(save); }}>
      <label>Name<Input required value={form.name} onChange={e => update({ name: e.target.value })} /></label>
      <label>When<Select value={form.event} onValueChange={v => {
        const event = v as GoogleTriggerEvent, choices = eligible(list, event);
        update({ event, resource: null, ...(choices.some(a => a.email === form.google_account) ? {} : { google_account: choices[0]?.email || "" }) });
      }}><SelectTrigger aria-label="Trigger event"><SelectValue /></SelectTrigger><SelectContent className="dev-popup">{EVENTS.map(ev => <SelectItem key={ev} value={ev}>{EVENT_LABEL[ev]}</SelectItem>)}</SelectContent></Select></label>
      <label>Google account<Select value={form.google_account || undefined} onValueChange={v => update({ google_account: v })}><SelectTrigger aria-label="Trigger Google account"><SelectValue placeholder="Choose an account" /></SelectTrigger><SelectContent className="dev-popup">
        {stale && <SelectItem value={form.google_account} disabled>{form.google_account} (unavailable)</SelectItem>}
        {accountChoices.map(a => <SelectItem key={a.email} value={a.email}>{a.email}</SelectItem>)}
      </SelectContent></Select></label>
      {!accountChoices.length && <p role="alert" className="text-sm text-destructive">No connected account granted {SERVICE_LABEL[EVENT_SERVICE[form.event]]} access. Reconnect an account in Freddai on your Mac and tick the {SERVICE_LABEL[EVENT_SERVICE[form.event]]} box.</p>}
      <label>{fields.filterLabel}<Input aria-label={fields.filterLabel} placeholder={fields.filterPlaceholder} value={form.filter || ""} onChange={e => update({ filter: e.target.value })} /></label>
      <p className="capture-help">{fields.filterHelp}</p>
      {fields.resourceLabel && <>
        <label>{fields.resourceLabel}<Input aria-label={fields.resourceLabel} placeholder={fields.resourcePlaceholder} value={form.resource || ""} onChange={e => update({ resource: e.target.value })} /></label>
        <p className="capture-help">{fields.resourceHelp}</p>
      </>}
      <DeliveryRouting form={form} update={update} db={db} subject="Trigger" fullAccessWarning={<p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{FULL_ACCESS_WARNING}</span></p>} />
      <DeliveryTask form={form} update={update} subject="Trigger" />
      <div className="schedule-switch-row"><label htmlFor="trigger-enabled">Enabled</label><Switch id="trigger-enabled" checked={form.enabled} onCheckedChange={checked => update({ enabled: checked })} /></div>
      <div className="capture-controls"><Button type="button" variant="ghost" onClick={() => { setForm(null); setError(""); }}>Cancel</Button><Button disabled={!native || busy || !form.account || !accountChoices.length}>Save trigger</Button></div>
    </form> : triggers?.length ? <ul className="divide-y">{triggers.map(t => {
      const fired = formatWhen(t.last_fired);
      return <li key={t.id} className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="flex flex-wrap items-center gap-2 break-words text-sm font-medium">{t.name}{t.options?.permission_mode === "bypass" && <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400" title="This trigger runs its agent without asking for approval">Full access</Badge>}</p>
            <p className="break-words text-sm text-muted-foreground">{EVENT_LABEL[t.event] || t.event} · {t.google_account}</p>
            <p className="text-xs text-muted-foreground">{fired ? `Last fired ${fired}` : "Never fired"} · {t.fire_count ?? 0} {t.fire_count === 1 ? "run" : "runs"}{t.filter ? ` · ${t.filter}` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2"><label htmlFor={`trigger-on-${t.id}`} className="text-xs text-muted-foreground">{t.enabled ? "On" : "Off"}</label><Switch id={`trigger-on-${t.id}`} aria-label={`${t.name} enabled`} checked={t.enabled} disabled={!native || busy} onCheckedChange={checked => void act(() => command("google_trigger_save", { trigger: { ...t, enabled: checked } }))} /></div>
        </div>
        {t.last_error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{t.last_error}</span></p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setError(""); setForm(t); }}>Edit<span className="sr-only"> {t.name}</span></Button>
          <Button variant="ghost" size="sm" disabled={!native || busy} onClick={() => setDeleting(t.id)}>Delete…<span className="sr-only"> {t.name}</span></Button>
        </div>
        {deleting === t.id && <div role="alert" className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm">Delete this trigger? Threads it already started are kept.</p>
          <div className="flex flex-wrap gap-2"><Button variant="destructive" size="sm" disabled={!native || busy} onClick={() => void act(async () => { await command("google_trigger_delete", { id: t.id }); setDeleting(""); })}>Delete trigger</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleting("")}>Keep trigger</Button></div>
        </div>}
      </li>;
    })}</ul> : <div className="space-y-1 p-5"><p className="text-sm font-medium">{!native ? "Open Freddai on your Mac to manage triggers" : !triggers ? (loadError ? "Triggers could not be loaded" : "Loading triggers…") : "No triggers yet"}</p>{triggers && <p className="text-sm text-muted-foreground">{noAccounts ? "Triggers need a connected Google account." : "Add a trigger to start agent work from Gmail, Calendar or Drive."}</p>}</div>}
  </section>;
}
