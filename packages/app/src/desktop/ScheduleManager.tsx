import { endDateShortcut, scheduleEnded, startedRuns, runLimitReached } from "./schedule-end";
import { agentDisplayName } from "./types";
import { X } from "lucide-react";
import { ScheduleEntries } from "./ScheduleEntries";
import { Switch } from "@freddai/ui/components/switch";
import { resolveAccount } from "./types";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@freddai/ui/components/select";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Textarea } from "@freddai/ui/components/textarea";
import type { Database, Schedule, Session } from "./types";
type ScheduleData = { projects: {id:string;name:string}[]; accounts: {id:string;name:string;provider:string}[]; schedules?: Schedule[]; sessions?: Session[] };
export type ScheduleCommand = (command: "save_schedule" | "schedule_action", input: Record<string, unknown>) => Promise<unknown>;
export function ScheduleManager({db,native,onRefresh,onSelect,command=invoke,context,projectId,scheduleId,onDeleted,conversation,onClose,onSaved}:{db:ScheduleData | Database;native:boolean;onRefresh:()=>Promise<void>;onSelect:(id:string)=>void;command?:ScheduleCommand;projectId?:string;scheduleId?:string;onDeleted?:()=>void;onClose?:()=>void;onSaved?:(id:string)=>void;conversation?:(props:{form:Schedule;setPrompt:(prompt:string)=>void;submit:()=>void;busy:boolean;disabled:boolean})=>ReactNode;context?:Pick<Session,"project"|"account"|"title"|"messages">}) {
  const blank=():Schedule=>{
    const account=context?.account||("preferences" in db?resolveAccount(db,db.projects.find(p=>p.id===projectId)||db.projects[0]):db.accounts[0]?.id)||"";
    return ({id:"",name:context?.title||"",project:context?.project||projectId||db.projects[0]?.id||"",account,routing:"fixed",new_chat:true,thread:null,notifications:"important",cron:"0 9 * * 1-5",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,prompt:context?.messages.find(m=>m.role==="user")?.text||"",enabled:true,options:{worktree:false,permission_mode:["codex","claude"].includes(db.accounts.find(a=>a.id===account)?.provider||"")?"bypass":"ask"},next_due:0,runs:[]});};
  const [form,setForm]=useState<Schedule>(()=>db.schedules?.find(s=>s.id===scheduleId)||blank()),[editing,setEditing]=useState(!!context||!!scheduleId||!!projectId),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await onRefresh();}catch(e){setError(String(e).includes("Use five cron fields") && form.cron.includes("\n") ? "The background host needs its update to save multiple schedules. Let active work finish so it can update, then save again." : String(e));}finally{setBusy(false);}}
  const [deleting,setDeleting]=useState("");

  const reusableThreads=(db.sessions||[]).filter(t=>t.project===form.project&&!t.archived&&!t.deleted_at&&t.status!=="archived"&&!!t.provider_id);
  const progress = {...form,runs:db.schedules?.find(s=>s.id===form.id)?.runs||form.runs};
  const update=(p:Partial<Schedule>)=>setForm(f=>({...f,...p}));
  const pendingCreation = useRef<{ids:Set<string>;form:Schedule}|null>(null);
  useEffect(()=>{
    const pending=pendingCreation.current;
    if (!pending) return;
    const matches=(db.schedules||[]).filter(s=>!pending.ids.has(s.id)&&s.name===pending.form.name&&s.project===pending.form.project&&s.account===pending.form.account&&s.prompt===pending.form.prompt);
    if(matches.length===1){pendingCreation.current=null;setForm(matches[0]);onSaved?.(matches[0].id);}
  },[db.schedules,onSaved]);
  async function save(run = false) {
    if (form.new_chat===false&&!form.thread) throw new Error("Choose the thread this routine should run in.");
    if (form.max_runs!=null && (!Number.isInteger(form.max_runs)||form.max_runs<1||form.max_runs>4294967295)) throw new Error("Enter a whole number of runs between 1 and 4294967295.");
    if (!form.name.trim() || !form.prompt.trim()) throw new Error("Add a name and task prompt first.");
    const pending = !form.id ? {ids:new Set((db.schedules||[]).map(s=>s.id)),form} : null;
    await command("save_schedule",{schedule:form});
    pendingCreation.current=pending;
    if (run && form.id) await command("schedule_action",{schedule:form.id,action:"run"});
    setEditing(false);
  }
  const deleteControls = (id:string) => <>
    <Button type="button" size="sm" variant="ghost" disabled={busy||!native} onClick={()=>setDeleting(id)}>Delete…</Button>
    {deleting===id&&<div role="alert"><p>Delete this scheduled task? Existing threads and their messages are kept. Running threads keep running.</p><Button type="button" variant="destructive" disabled={busy||!native} onClick={()=>void act(async()=>{await command("schedule_action",{schedule:id,action:"delete"});setDeleting("");if(form.id===id){setForm(blank());setEditing(false);}onDeleted?.();})}>Delete schedule</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setDeleting("")}>Keep schedule</Button></div>}
  </>;
  const configuration = <div className="schedule-manager">{error&&<p role="alert">{error}</p>}
    {(!editing||!!scheduleId)&&<>{!scheduleId&&<Button variant="outline" onClick={()=>{setForm(blank());setEditing(true);}} disabled={!db.projects.length||!db.accounts.length}>New schedule</Button>}
      {!(db.schedules||[]).length&&<p className="capture-help">No schedules yet. Choose a project, account, and prompt. Signing out blocks runs without deleting the schedule.</p>}
      {(db.schedules||[]).filter(s=>scheduleId?s.id===scheduleId:!projectId||s.project===projectId).map(s=><section className="schedule-card" key={s.id}><strong>{s.name}</strong><p>{db.projects.find(p=>p.id===s.project)?.name} · {scheduleEnded(s)?"Ended":s.enabled?`Next ${new Date(s.next_due).toLocaleString(undefined,{timeZone:s.timezone})}`:"Paused"}</p><small>{s.timezone} · {db.accounts.find(a=>a.id===s.account)?.name}{` · ${s.runs.filter(r=>r.session).length}${s.max_runs!=null?`/${s.max_runs}`:""} runs · ${new Set(s.runs.flatMap(r=>r.session?[r.session]:[])).size} threads`}</small>
        <div className="capture-controls"><Button size="sm" variant="ghost" onClick={()=>{setForm(s);setEditing(true);}}>Edit</Button><Button size="sm" variant="ghost" disabled={busy||!native} onClick={()=>void act(async()=>{await command("schedule_action",{schedule:s.id,action:s.enabled?"pause":"resume"});update({enabled:!s.enabled});})}>{s.enabled?"Pause":"Enable"}</Button><Button size="sm" variant="outline" disabled={busy||!native||runLimitReached(s)} onClick={()=>void act(()=>command("schedule_action",{schedule:s.id,action:"run"}))}>Run now</Button>{!editing&&deleteControls(s.id)}</div>
        {!!s.runs.length&&<details><summary>Run history ({s.runs.length})</summary>{[...s.runs].reverse().map(r=><div className="schedule-run" key={r.id}><span>{new Date(r.due).toLocaleString()} · {r.state}{r.session&&` · ${db.sessions?.find(t=>t.id===r.session)?.title||"Thread"}`}</span>{r.reason&&<p>{r.reason}</p>}{r.session&&<Button size="sm" variant="ghost" onClick={()=>onSelect(r.session!)}>Open thread</Button>}</div>)}</details>}
      </section>)}
    </>}{editing&&<form onSubmit={e=>{e.preventDefault();void act(()=>save());}}>
      <label>Name<Input required value={form.name} onChange={e=>update({name:e.target.value})}/></label>
      <label>Project<Select value={form.project} onValueChange={v=>update({project:v,...(form.new_chat===false?{thread:null}:{})})}><SelectTrigger aria-label="Schedule project"><SelectValue/></SelectTrigger><SelectContent className="dev-popup">{db.projects.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
      <label>Agent / account<Select disabled={form.new_chat===false} value={form.account||undefined} onValueChange={v=>update({account:v,routing:"fixed",...(!["codex","claude"].includes(db.accounts.find(a=>a.id===v)?.provider||"")?{options:{...form.options,permission_mode:"ask"}}:{})})}><SelectTrigger aria-label="Schedule account"><SelectValue placeholder="Choose an account"/></SelectTrigger><SelectContent className="dev-popup">{db.accounts.map(a=><SelectItem key={a.id} value={a.id}>{agentDisplayName(a)}</SelectItem>)}</SelectContent></Select></label>
      <div className="schedule-switch-row"><label htmlFor="schedule-new-chat">Start each run in a new chat</label><Switch id="schedule-new-chat" checked={form.new_chat!==false} onCheckedChange={checked=>update({new_chat:checked,thread:null,...(!checked?{routing:"fixed"}:{})})}/></div>
      {form.new_chat===false&&<>
        <label>Runs in<Select value={form.thread||undefined} onValueChange={id=>{const thread=reusableThreads.find(t=>t.id===id);if(thread){update({thread:id,account:thread.account,routing:"fixed"});if(conversation)onSelect(id);}}}><SelectTrigger aria-label="Runs in"><SelectValue placeholder="Choose a thread"/></SelectTrigger><SelectContent className="dev-popup">
          {form.thread&&!reusableThreads.some(t=>t.id===form.thread)&&<SelectItem value={form.thread} disabled>Thread unavailable</SelectItem>}
          {reusableThreads.map(t=><SelectItem key={t.id} value={t.id}>{t.title}{["starting","running","waiting"].includes(t.status)?" (busy)":""}</SelectItem>)}
        </SelectContent></Select></label>
        <p className="capture-help">Uses this thread’s agent and working folder. Busy threads skip that occurrence.</p>
      </>}
      <div className="schedule-switch-row"><label htmlFor="schedule-full-access">Full access</label><Switch id="schedule-full-access" checked={form.options.permission_mode==="bypass"} disabled={!['codex','claude'].includes(db.accounts.find(a=>a.id===form.account)?.provider||'')&&form.options.permission_mode!=="bypass"} onCheckedChange={checked=>update({options:{...form.options,permission_mode:checked?"bypass":"ask"}})}/></div>
      <p className="capture-help">Full access lets supported agents run tools without approval prompts. Applies when the next run starts, including in an existing thread.</p>
      <label>Notifications<Select value={form.notifications||"off"} onValueChange={value=>update({notifications:value as Schedule["notifications"]})}><SelectTrigger aria-label="Notifications"><SelectValue/></SelectTrigger><SelectContent className="dev-popup"><SelectItem value="important">Important updates only</SelectItem><SelectItem value="all">Every completed run and issues</SelectItem><SelectItem value="off">Off</SelectItem></SelectContent></Select></label>
      {form.notifications==="important"&&<p className="capture-help">Actionable findings, failures, and requests for approval. Quiet checks stay in the chat.</p>}
      <ScheduleEntries value={form.cron} onChange={cron=>update({cron})}/>
      <label>Timezone<Input required value={form.timezone} onChange={e=>update({timezone:e.target.value})}/></label>
      <label>Stops<Select value={form.max_runs!=null?"runs":form.end_date?"date":"never"} onValueChange={value=>{
        if(value==="never") update({end_date:null,max_runs:null});
        else if(value==="runs") update({end_date:null,max_runs:startedRuns(progress)+10});
        else { try{update({end_date:form.end_date||endDateShortcut(form.timezone,"week"),max_runs:null});setError("");}catch{setError("Choose a valid timezone first.");} }
      }}><SelectTrigger aria-label="Stops"><SelectValue/></SelectTrigger><SelectContent className="dev-popup"><SelectItem value="never">No limit</SelectItem><SelectItem value="date">On a specific date</SelectItem><SelectItem value="runs">After a number of runs</SelectItem></SelectContent></Select></label>
      {form.max_runs!=null ? <div>
        <label>Number of runs<Input type="number" min={1} max={4294967295} step={1} required aria-label="Number of runs" value={form.max_runs||""} onChange={e=>update({max_runs:e.target.value===""?0:Number(e.target.value)})}/></label>
        <p className="capture-help">{startedRuns(progress)} of {form.max_runs||"…"} runs started. Includes previous and manual runs; skipped, missed, and blocked attempts don’t count.</p>
        {progress.runs.some(r=>r.state==="uncertain"&&!r.session)&&<p className="capture-help">Unconfirmed launches after a restart reserve a run until their outcome is known.</p>}
      </div> : form.end_date&&<div className="schedule-end-date">
        <label>End by<Input type="date" required aria-label="End by" value={form.end_date} onChange={e=>update({end_date:e.target.value||null})}/></label>
        <div className="capture-controls">
          {(["week","month"] as const).map(period=><Button key={period} type="button" size="sm" variant="outline" onClick={()=>{try{update({end_date:endDateShortcut(form.timezone,period)});setError("");}catch{setError("Choose a valid timezone first.");}}}>Next {period}</Button>)}
        </div>
        <p className="capture-help">Runs through {form.end_date} in {form.timezone}, then stops automatically. Runs already started can finish.</p>
      </div>}
      <label>Task<Textarea required value={form.prompt} onChange={e=>update({prompt:e.target.value})}/></label>
      {form.new_chat!==false&&<div className="schedule-switch-row"><label htmlFor="schedule-worktree">Separate worktree</label><Switch id="schedule-worktree" checked={!!form.options.worktree} onCheckedChange={checked=>update({options:{...form.options,worktree:checked}})}/></div>}
      <div className="schedule-switch-row"><label htmlFor="schedule-enabled">Enabled</label><Switch id="schedule-enabled" checked={form.enabled} onCheckedChange={checked=>update({enabled:checked})}/></div>
      <div className="capture-controls"><Button type="button" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={!native||busy||!form.account}>Save schedule</Button>{form.id&&deleteControls(form.id)}</div>
    </form>}
  </div>;
  if (!conversation) return configuration;
  return <div className="schedule-workspace">
    <div className="schedule-conversation">{conversation({form,setPrompt:prompt=>update({prompt}),submit:()=>void act(()=>save(true)),busy,disabled:!native||busy||runLimitReached(progress)||!form.account||!form.prompt.trim()||!form.name.trim()||(!form.id&&!editing)})}</div>
    <aside className="schedule-configuration" aria-label="Scheduled task configuration">
      <div className="pane-title"><span>Schedule configuration</span><Button className="ml-auto" variant="ghost" size="icon" aria-label="Close schedule" onClick={onClose}><X size={14}/></Button></div>
      {configuration}
    </aside>
  </div>;
}
