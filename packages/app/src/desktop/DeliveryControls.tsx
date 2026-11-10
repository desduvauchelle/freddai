import type { ReactNode } from "react";
import { Switch } from "@freddai/ui/components/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@freddai/ui/components/select";
import { Textarea } from "@freddai/ui/components/textarea";
import { agentDisplayName } from "./types";
import type { Schedule, Session } from "./types";

/** Where and how an automated run is delivered. Identical on Schedules and Google triggers. */
export type DeliveryFields = Pick<Schedule, "project" | "account" | "routing" | "new_chat" | "thread" | "notifications" | "prompt" | "options">;
export type DeliveryData = { projects: { id: string; name: string }[]; accounts: { id: string; name: string; provider: string }[]; sessions?: Session[] };
type Props<T extends DeliveryFields> = {
  form: T;
  update: (patch: Partial<T>) => void;
  db: DeliveryData;
  /** Prefix for accessible names and element ids, e.g. "Schedule" or "Trigger". */
  subject?: string;
  onThreadChosen?: (id: string) => void;
  /** Shown directly under the Full access switch while it is on. Unset on schedules. */
  fullAccessWarning?: ReactNode;
};
const fullAccessProvider = (db: DeliveryData, account: string) => ["codex", "claude"].includes(db.accounts.find(a => a.id === account)?.provider || "");

/** Project, agent account, new chat vs existing thread, full access, notifications. */
export function DeliveryRouting<T extends DeliveryFields>({ form, update, db, subject = "Schedule", onThreadChosen, fullAccessWarning }: Props<T>) {
  const id = subject.toLowerCase();
  const reusableThreads = (db.sessions || []).filter(t => t.project === form.project && !t.archived && !t.deleted_at && t.status !== "archived" && !!t.provider_id);
  const set = (patch: Partial<DeliveryFields>) => update(patch as Partial<T>);
  return <>
    <label>Project<Select value={form.project} onValueChange={v => set({ project: v, ...(form.new_chat === false ? { thread: null } : {}) })}><SelectTrigger aria-label={`${subject} project`}><SelectValue /></SelectTrigger><SelectContent className="dev-popup">{db.projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
    <label>Agent / account<Select disabled={form.new_chat === false} value={form.account || undefined} onValueChange={v => set({ account: v, routing: "fixed", ...(!fullAccessProvider(db, v) ? { options: { ...form.options, permission_mode: "ask" } } : {}) })}><SelectTrigger aria-label={`${subject} account`}><SelectValue placeholder="Choose an account" /></SelectTrigger><SelectContent className="dev-popup">{db.accounts.map(a => <SelectItem key={a.id} value={a.id}>{agentDisplayName(a)}</SelectItem>)}</SelectContent></Select></label>
    <div className="schedule-switch-row"><label htmlFor={`${id}-new-chat`}>Start each run in a new chat</label><Switch id={`${id}-new-chat`} checked={form.new_chat !== false} onCheckedChange={checked => set({ new_chat: checked, thread: null, ...(!checked ? { routing: "fixed" } : {}) })} /></div>
    {form.new_chat === false && <>
      <label>Runs in<Select value={form.thread || undefined} onValueChange={tid => { const thread = reusableThreads.find(t => t.id === tid); if (thread) { set({ thread: tid, account: thread.account, routing: "fixed" }); onThreadChosen?.(tid); } }}><SelectTrigger aria-label="Runs in"><SelectValue placeholder="Choose a thread" /></SelectTrigger><SelectContent className="dev-popup">
        {form.thread && !reusableThreads.some(t => t.id === form.thread) && <SelectItem value={form.thread} disabled>Thread unavailable</SelectItem>}
        {reusableThreads.map(t => <SelectItem key={t.id} value={t.id}>{t.title}{["starting", "running", "waiting"].includes(t.status) ? " (busy)" : ""}</SelectItem>)}
      </SelectContent></Select></label>
      <p className="capture-help">Uses this thread’s agent and working folder. Busy threads skip that occurrence.</p>
    </>}
    <div className="schedule-switch-row"><label htmlFor={`${id}-full-access`}>Full access</label><Switch id={`${id}-full-access`} checked={form.options.permission_mode === "bypass"} disabled={!fullAccessProvider(db, form.account) && form.options.permission_mode !== "bypass"} onCheckedChange={checked => set({ options: { ...form.options, permission_mode: checked ? "bypass" : "ask" } })} /></div>
    {fullAccessWarning && form.options.permission_mode === "bypass" && fullAccessWarning}
    <p className="capture-help">Full access lets supported agents run tools without approval prompts. Applies when the next run starts, including in an existing thread.</p>
    <label>Notifications<Select value={form.notifications || "off"} onValueChange={value => set({ notifications: value as Schedule["notifications"] })}><SelectTrigger aria-label="Notifications"><SelectValue /></SelectTrigger><SelectContent className="dev-popup"><SelectItem value="important">Important updates only</SelectItem><SelectItem value="all">Every completed run and issues</SelectItem><SelectItem value="off">Off</SelectItem></SelectContent></Select></label>
    {form.notifications === "important" && <p className="capture-help">Actionable findings, failures, and requests for approval. Quiet checks stay in the chat.</p>}
  </>;
}

/** Task prompt and separate-worktree switch. */
export function DeliveryTask<T extends DeliveryFields>({ form, update, subject = "Schedule" }: Pick<Props<T>, "form" | "update" | "subject">) {
  const id = subject.toLowerCase();
  return <>
    <label>Task<Textarea required value={form.prompt} onChange={e => update({ prompt: e.target.value } as Partial<T>)} /></label>
    {form.new_chat !== false && <div className="schedule-switch-row"><label htmlFor={`${id}-worktree`}>Separate worktree</label><Switch id={`${id}-worktree`} checked={!!form.options.worktree} onCheckedChange={checked => update({ options: { ...form.options, worktree: checked } } as Partial<T>)} /></div>}
  </>;
}
