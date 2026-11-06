import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@freddai/ui/components/select';
import { readSchedule, scheduleCron, type Repeat } from './schedule-controls';

const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weekOrder = [1,2,3,4,5,6,0];
export function ScheduleEntries({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const entries=value.split('\n');
  function update(index:number, cron:string) { onChange(entries.map((entry,i)=>i===index?cron:entry).join('\n')); }
  return <section className="schedule-entries" aria-label="Schedules">
    <div className="schedule-entries-heading"><strong>Schedules</strong><Button type="button" variant="ghost" size="sm" disabled={entries.length>=32} onClick={()=>onChange([...entries,'0 9 * * 1-5'].join('\n'))}><Plus size={13}/>Add schedule</Button></div>
    {entries.map((entry,index)=>{
      const timing=readSchedule(entry);
      const selected=timing.repeat==='daily' ? ['0','1','2','3','4','5','6'] : timing.repeat==='weekdays' ? ['1','2','3','4','5'] : timing.day.split(',');
      const set=(repeat:Repeat,time=timing.time,day=timing.day)=>{if(repeat!=='custom')update(index,scheduleCron(repeat,time,day));};
      return <fieldset className="schedule-entry" key={index}>
        <legend>Schedule {index+1}</legend>
        <div className="schedule-entry-controls">
          <label>Repeat<Select value={timing.repeat} onValueChange={v=>set(v as Repeat,timing.time,'1')}><SelectTrigger aria-label={`Schedule ${index+1} repeat`}><SelectValue/></SelectTrigger><SelectContent className="dev-popup"><SelectItem value="weekly">Selected weekdays</SelectItem><SelectItem value="daily">Every day</SelectItem><SelectItem value="weekdays">Weekdays</SelectItem><SelectItem value="monthly">Every month</SelectItem>{timing.repeat==='custom'&&<SelectItem value="custom">Existing custom schedule</SelectItem>}</SelectContent></Select></label>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove schedule ${index+1}`} disabled={entries.length===1} onClick={()=>onChange(entries.filter((_,i)=>i!==index).join('\n'))}><Trash2 size={14}/></Button>
        </div>
        {timing.repeat==='custom' ? <p className="capture-help">This custom schedule is kept unless you choose a repeat option above.</p> : <>
          {timing.repeat!=='monthly'&&<div className="schedule-weekdays" role="group" aria-label={`Schedule ${index+1} weekdays`}>
            {weekOrder.map(day=>{const checked=selected.includes(String(day));return <Button type="button" key={day} variant={checked?'secondary':'outline'} size="sm" aria-label={days[day]} aria-pressed={checked} disabled={checked&&selected.length===1} onClick={()=>{
              const next=checked?selected.filter(d=>d!==String(day)):[...selected,String(day)];
              set('weekly',timing.time,next.sort((a,b)=>Number(a)-Number(b)).join(','));
            }}>{days[day].slice(0,2)}</Button>;})}
          </div>}
          {timing.repeat==='monthly'&&<label>Day of month<Select value={timing.day} onValueChange={v=>set('monthly',timing.time,v)}><SelectTrigger aria-label={`Schedule ${index+1} day of month`}><SelectValue/></SelectTrigger><SelectContent className="dev-popup">{Array.from({length:31},(_,i)=><SelectItem key={i+1} value={String(i+1)}>{i+1}</SelectItem>)}</SelectContent></Select></label>}
          <label>At<Input type="time" required aria-label={`Schedule ${index+1} time`} value={timing.time} onChange={e=>{if(e.target.value)set(timing.repeat,e.target.value);}}/></label>
          {timing.repeat==='monthly'&&Number(timing.day)>28&&<p className="capture-help">Runs in months that have day {timing.day}.</p>}
        </>}
      </fieldset>;
    })}
  </section>;
}
