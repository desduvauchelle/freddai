import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@freddai/ui/components/select";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Textarea } from "@freddai/ui/components/textarea";
import type { Database, Schedule } from "./types";
import { resolveAccount } from "./types";
export function ScheduleManager({db,native,onRefresh,onSelect}:{db:Database;native:boolean;onRefresh:()=>Promise<void>;onSelect:(id:string)=>void}) {
  const blank=():Schedule=>({id:"",name:"",project:db.projects[0]?.id||"",account:resolveAccount(db,db.projects[0]),routing:"fixed",cron:"0 9 * * 1-5",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,prompt:"",enabled:true,options:{worktree:false},next_due:0,runs:[]});
  const [form,setForm]=useState<Schedule>(blank),[editing,setEditing]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await onRefresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  const update=(p:Partial<Schedule>)=>setForm(f=>({...f,...p}));
  return <div className="schedule-manager">{error&&<p role="alert">{error}</p>}
    {!editing?<><Button variant="outline" onClick={()=>{setForm(blank());setEditing(true);}} disabled={!db.projects.length||!db.accounts.length}>New schedule</Button>
      {!(db.schedules||[]).length&&<p className="capture-help">No schedules yet. Choose a project, account, and prompt. Signing out blocks runs without deleting the schedule.</p>}
      {(db.schedules||[]).map(s=><section className="schedule-card" key={s.id}><strong>{s.name}</strong><p>{db.projects.find(p=>p.id===s.project)?.name} · {s.enabled?`Next ${new Date(s.next_due).toLocaleString()}`:"Paused"}</p><small>{s.cron} · {s.timezone} · {db.accounts.find(a=>a.id===s.account)?.name} {s.routing==="project"?"(project routing)":"(pinned)"}</small>
        <div className="capture-controls"><Button size="sm" variant="ghost" onClick={()=>{setForm(s);setEditing(true);}}>Edit</Button><Button size="sm" variant="ghost" disabled={busy||!native} onClick={()=>void act(()=>invoke("schedule_action",{schedule:s.id,action:s.enabled?"pause":"resume"}))}>{s.enabled?"Pause":"Enable"}</Button><Button size="sm" variant="outline" disabled={busy||!native} onClick={()=>void act(()=>invoke("schedule_action",{schedule:s.id,action:"run"}))}>Run now</Button></div>
        {!!s.runs.length&&<details><summary>Run history ({s.runs.length})</summary>{[...s.runs].reverse().slice(0,30).map(r=><div className="schedule-run" key={r.id}><span>{new Date(r.due).toLocaleString()} · {r.state}</span>{r.reason&&<p>{r.reason}</p>}{r.session&&<Button size="sm" variant="ghost" onClick={()=>onSelect(r.session!)}>Open thread</Button>}</div>)}</details>}
      </section>)}
    </>:<form onSubmit={e=>{e.preventDefault();void act(async()=>{await invoke("save_schedule",{schedule:form});setEditing(false);});}}>
      <label>Name<Input required value={form.name} onChange={e=>update({name:e.target.value})}/></label>
      <label>Project<Select value={form.project} onValueChange={v=>update({project:v})}><SelectTrigger aria-label="Schedule project"><SelectValue/></SelectTrigger><SelectContent className="dev-popup">{db.projects.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
      <label>Account<Select value={form.account||undefined} onValueChange={v=>update({account:v})}><SelectTrigger aria-label="Schedule account"><SelectValue placeholder="Choose an account"/></SelectTrigger><SelectContent className="dev-popup">{db.accounts.map(a=><SelectItem key={a.id} value={a.id}>{a.provider} · {a.name}</SelectItem>)}</SelectContent></Select></label>
      <label>Routing<Select value={form.routing} onValueChange={v=>update({routing:v})}><SelectTrigger aria-label="Schedule account routing"><SelectValue/></SelectTrigger><SelectContent className="dev-popup"><SelectItem value="fixed">Always this account</SelectItem><SelectItem value="project">Project preference, with this account as fallback</SelectItem></SelectContent></Select></label>
      <label>Cron (minute hour day month weekday)<Input required value={form.cron} onChange={e=>update({cron:e.target.value})}/></label>
      <label>Timezone<Input required value={form.timezone} onChange={e=>update({timezone:e.target.value})}/></label>
      <label>Task<Textarea required value={form.prompt} onChange={e=>update({prompt:e.target.value})}/></label>
      <label className="view-setting">Separate worktree<input type="checkbox" checked={!!form.options.worktree} onChange={e=>update({options:{...form.options,worktree:e.target.checked}})}/></label>
      <label className="view-setting">Enabled<input type="checkbox" checked={form.enabled} onChange={e=>update({enabled:e.target.checked})}/></label>
      <p className="capture-help">Overlapping runs are skipped. Busy folders or signed-out accounts block that occurrence. Missed runs do not catch up. Agent permissions still require your approval.</p>
      <div className="capture-controls"><Button type="button" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={!native||busy||!form.account}>Save schedule</Button></div>
    </form>}
  </div>;
}
