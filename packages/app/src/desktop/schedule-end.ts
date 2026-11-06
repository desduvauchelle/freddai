import type { Schedule } from './types';
export function dateInZone(timezone:string, now=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function endDateShortcut(timezone:string, period:'week'|'month', now=new Date()):string {
  const [year,month,day]=dateInZone(timezone,now).split('-').map(Number);
  const date=period==='week' ? new Date(Date.UTC(year,month-1,day+7)) : new Date(Date.UTC(year,month,Math.min(day,new Date(Date.UTC(year,month+1,0)).getUTCDate())));
  return date.toISOString().slice(0,10);
}
export function startedRuns(schedule:Pick<Schedule,'runs'>):number { return schedule.runs.filter(r=>r.session!=null).length; }
export function runLimitReached(schedule:Pick<Schedule,'max_runs'> & Partial<Pick<Schedule,'runs'>>):boolean {
  return schedule.max_runs!=null && (schedule.runs||[]).filter(r=>r.session!=null||r.state==='uncertain').length>=schedule.max_runs;
}
export function scheduleEnded(schedule:Pick<Schedule,'end_date'|'timezone'|'next_due'|'enabled'> & Partial<Pick<Schedule,'max_runs'|'runs'>>):boolean {
  if(runLimitReached(schedule)) return true;
  if(!schedule.end_date) return false;
  try { return schedule.end_date<dateInZone(schedule.timezone)||(!schedule.enabled&&schedule.next_due===0); } catch { return false; }
}
