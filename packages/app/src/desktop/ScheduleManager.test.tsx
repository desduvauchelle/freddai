import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleManager } from './ScheduleManager';
import type { Schedule } from './types';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
afterEach(cleanup);
vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} });
HTMLElement.prototype.scrollIntoView=vi.fn();
HTMLElement.prototype.hasPointerCapture=()=>false;
HTMLElement.prototype.releasePointerCapture=vi.fn();
HTMLElement.prototype.setPointerCapture=vi.fn();
const schedule: Schedule = {id:'s',name:'Weekly check',project:'p',account:'removed-account',routing:'fixed',cron:'0 9 * * 1',timezone:'UTC',prompt:'Summarize open work',enabled:false,options:{},next_due:1800000000000,runs:[]};
const db = {projects:[{id:'p',name:'Project'}],accounts:[],schedules:[schedule]};
it('updates an existing task through day and time controls',async()=>{
  const command=vi.fn(async()=>{}),refresh=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} onRefresh={refresh} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('button',{name:'Edit'}));
  await userEvent.click(screen.getByRole('button',{name:'Friday'}));
  await userEvent.click(screen.getByRole('button',{name:'Monday'}));
  fireEvent.change(screen.getByLabelText('Schedule 1 time'),{target:{value:'14:00'}});
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,cron:'0 14 * * 5'}}));
  expect(refresh).toHaveBeenCalled();
});
it('requires confirmation before deletion and does not launch a run',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} onRefresh={async()=>{}} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('button',{name:'Delete…'}));
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Delete schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('schedule_action',{schedule:'s',action:'delete'}));
});
it('disables mutations while disconnected',()=>{
  render(<ScheduleManager db={db} native={false} onRefresh={async()=>{}} onSelect={()=>{}}/>);
  for(const name of ['Enable','Run now','Delete…']) expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);
});
it('creates from thread context without sending a provider turn',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} context={{project:'p',account:'removed-account',title:'Thread task',messages:[{id:'m',role:'user',text:'Summarize open work'}]}} onRefresh={async()=>{}} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('combobox',{name:'Schedule 1 repeat'}));
  await userEvent.click(screen.getByRole('option',{name:'Every day'}));
  fireEvent.change(screen.getByLabelText('Schedule 1 time'),{target:{value:'08:00'}});
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:expect.objectContaining({id:'',project:'p',account:'removed-account',prompt:'Summarize open work',cron:'0 8 * * *'})}));
});
it('opens the selected schedule configuration beside its history and pauses through the host',async()=>{
  const command=vi.fn(async()=>{}),onSelect=vi.fn();
  const selected={...schedule,enabled:true,runs:[{id:'run',due:1800000000000,state:'done',session:'thread',reason:null}]};
  render(<ScheduleManager db={{...db,schedules:[selected,{...schedule,id:'other',name:'Other task'}]}} native command={command} scheduleId="s" projectId="p" onRefresh={async()=>{}} onSelect={onSelect}/>);
  expect(screen.getByDisplayValue('Weekly check')).toBeTruthy();
  expect(screen.queryByText('Other task')).toBeNull();
  await userEvent.click(screen.getByText('Run history (1)'));
  await userEvent.click(screen.getByRole('button',{name:'Open thread'}));
  expect(onSelect).toHaveBeenCalledWith('thread');
  await userEvent.click(screen.getByRole('button',{name:'Pause'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('schedule_action',{schedule:'s',action:'pause'}));
  expect(screen.getByRole('switch',{name:'Enabled'}).getAttribute('aria-checked')).toBe('false');
});
it('starts a project-scoped schedule without creating an account or launching an agent',()=>{
  const command=vi.fn();
  render(<ScheduleManager db={{...db,projects:[...db.projects,{id:'p2',name:'Second project'}]}} native command={command} projectId="p2" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect(screen.getByRole('combobox',{name:'Schedule project'}).textContent).toContain('Second project');
  expect((screen.getByRole('button',{name:'Save schedule'}) as HTMLButtonElement).disabled).toBe(true);
  expect(command).not.toHaveBeenCalled();
});

it('preserves custom recurrence and routing without exposing cron or routing inputs',async()=>{
  const custom={...schedule,cron:'*/15 * * * *',routing:'project'};
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={{...db,schedules:[custom]}} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect(screen.queryByLabelText(/Cron|Routing|When/)).toBeNull();
  expect(screen.getByText(/kept unless you choose/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  expect(command).toHaveBeenCalledWith('save_schedule',{schedule:custom});
});
it('shares the prompt with the conversation and saves before requesting a run',async()=>{
  const command=vi.fn(async(..._args: unknown[])=>{});
  render(<ScheduleManager db={db} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}
    conversation={({form,setPrompt,submit})=><><input aria-label="Composer" value={form.prompt} onChange={e=>setPrompt(e.target.value)}/><button onClick={submit}>Send routine</button></>}/>);
  fireEvent.change(screen.getByLabelText('Composer'),{target:{value:'Review the changes'}});
  expect((screen.getByLabelText('Task') as HTMLTextAreaElement).value).toBe('Review the changes');
  await userEvent.click(screen.getByRole('button',{name:'Send routine'}));
  await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[0]).toEqual(['save_schedule',{schedule:{...schedule,prompt:'Review the changes'}}]);
  expect(command.mock.calls[1]).toEqual(['schedule_action',{schedule:'s',action:'run'}]);
});
it('selects a newly saved routine from the refreshed snapshot without creating a provider turn',async()=>{
  const command=vi.fn(async()=>{}),onSaved=vi.fn();
  const context={project:'p',account:'removed-account',title:'New routine',messages:[{id:'m',role:'user' as const,text:'Review work'}]};
  const props={native:true,command,context,projectId:'p',onRefresh:async()=>{},onSelect:()=>{},onSaved};
  const {rerender}=render(<ScheduleManager {...props} db={db}/>);
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
  rerender(<ScheduleManager {...props} db={{...db,schedules:[...db.schedules,{...schedule,id:'created',name:'New routine',prompt:'Review work'}]}}/>);
  await waitFor(()=>expect(onSaved).toHaveBeenCalledWith('created'));
  expect(command).toHaveBeenCalledTimes(1);
});
it('keeps the draft and does not run when saving fails',async()=>{
  const command=vi.fn(async()=>{throw new Error('Host unavailable');});
  render(<ScheduleManager db={db} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}
    conversation={({submit})=><button onClick={submit}>Send routine</button>}/>);
  await userEvent.click(screen.getByRole('button',{name:'Send routine'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Host unavailable'));
  expect(command).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('Summarize open work')).toBeTruthy();
});

it('adds, edits, removes, and reloads independent weekday/time entries',async()=>{
  const command=vi.fn(async()=>{});
  const {unmount}=render(<ScheduleManager db={db} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  const first=within(screen.getByRole('group',{name:'Schedule 1 weekdays'}));
  await userEvent.click(first.getByRole('button',{name:'Wednesday'}));
  await userEvent.click(first.getByRole('button',{name:'Friday'}));
  await userEvent.click(screen.getByRole('button',{name:'Add schedule'}));
  const second=within(screen.getByRole('group',{name:'Schedule 2 weekdays'}));
  await userEvent.click(second.getByRole('button',{name:'Wednesday'}));
  await userEvent.click(second.getByRole('button',{name:'Friday'}));
  fireEvent.change(screen.getByLabelText('Schedule 2 time'),{target:{value:'15:30'}});
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  const cron='0 9 * * 1,3,5\n30 15 * * 1,2,4';
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,cron}}));
  unmount();
  render(<ScheduleManager db={{...db,schedules:[{...schedule,cron}]}} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect((screen.getByLabelText('Schedule 2 time') as HTMLInputElement).value).toBe('15:30');
  expect(within(screen.getByRole('group',{name:'Schedule 2 weekdays'})).getByRole('button',{name:'Thursday'}).getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(screen.getByRole('button',{name:'Remove schedule 1'}));
  expect((screen.getByLabelText('Schedule 1 time') as HTMLInputElement).value).toBe('15:30');
  expect((screen.getByRole('button',{name:'Remove schedule 1'}) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenLastCalledWith('save_schedule',{schedule:{...schedule,cron:'30 15 * * 1,2,4'}}));
});
it('keeps at least one day selected per weekly schedule',()=>{
  render(<ScheduleManager db={db} native scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect((screen.getByRole('button',{name:'Monday'}) as HTMLButtonElement).disabled).toBe(true);
});
it('saves an inclusive end date and can clear it without changing schedules',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('combobox',{name:'Stops'}));
  await userEvent.click(screen.getByRole('option',{name:'On a specific date'}));
  fireEvent.change(screen.getByLabelText('End by'),{target:{value:'2027-01-31'}});
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,end_date:'2027-01-31',max_runs:null}}));
  await userEvent.click(screen.getByRole('button',{name:'Edit'}));
  await userEvent.click(screen.getByRole('combobox',{name:'Stops'}));
  await userEvent.click(screen.getByRole('option',{name:'On a specific date'}));
  await userEvent.click(screen.getByRole('button',{name:'Next week'}));
  expect((screen.getByLabelText('End by') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await userEvent.click(screen.getByRole('combobox',{name:'Stops'}));
  await userEvent.click(screen.getByRole('option',{name:'No limit'}));
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenLastCalledWith('save_schedule',{schedule:{...schedule,end_date:null,max_runs:null}}));
});

it('saves a run limit as an alternative to the end date and rejects fractional limits',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={{...db,schedules:[{...schedule,end_date:'2027-01-31'}]}} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}
    conversation={({submit})=><button onClick={submit}>Submit routine</button>}/>);
  await userEvent.click(screen.getByRole('combobox',{name:'Stops'}));
  await userEvent.click(screen.getByRole('option',{name:'After a number of runs'}));
  expect(screen.queryByLabelText('End by')).toBeNull();
  fireEvent.change(screen.getByLabelText('Number of runs'),{target:{value:'2.5'}});
  await userEvent.click(screen.getByRole('button',{name:'Submit routine'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('whole number'));
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Number of runs'),{target:{value:'5'}});
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,end_date:null,max_runs:5}}));
});
it('shows ended and disables Run now when all run slots are used',()=>{
  const capped={...schedule,max_runs:1,runs:[{id:'r',due:1,state:'failed',session:'old-thread',reason:null}]};
  render(<ScheduleManager db={{...db,schedules:[capped]}} native scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect(screen.getByText(/1 of 1 runs started/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Run now'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Ended/)).toBeTruthy();
});
it('refreshes run progress while preserving an unsaved prompt',()=>{
  const props={native:true,scheduleId:'s',onRefresh:async()=>{},onSelect:()=>{}};
  const capped={...schedule,max_runs:2};
  const {rerender}=render(<ScheduleManager {...props} db={{...db,schedules:[capped]}}/>);
  fireEvent.change(screen.getByLabelText('Task'),{target:{value:'Keep this draft'}});
  rerender(<ScheduleManager {...props} db={{...db,schedules:[{...capped,runs:[{id:'new',due:1,state:'done',session:'started',reason:null}]}]}}/>);
  expect(screen.getByText(/1 of 2 runs started/)).toBeTruthy();
  expect(screen.getByDisplayValue('Keep this draft')).toBeTruthy();
});
it('selects an existing thread, keeps its agent, and hides the new-worktree control',async()=>{
  const command=vi.fn(async()=>{}),onSelect=vi.fn();
  const thread={id:'target',project:'p',account:'removed-account',title:'Investigate memory errors',status:'done',updated:1,provider_id:'established',messages:[],pending:null,error:null};
  render(<ScheduleManager db={{...db,sessions:[thread]}} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={onSelect} conversation={()=><div/>}/>);
  await userEvent.click(screen.getByRole('switch',{name:'Start each run in a new chat'}));
  await userEvent.click(screen.getByRole('combobox',{name:'Runs in'}));
  await userEvent.click(screen.getByRole('option',{name:'Investigate memory errors'}));
  expect(onSelect).toHaveBeenCalledWith('target');
  expect(screen.queryByRole('switch',{name:'Separate worktree'})).toBeNull();
  await userEvent.click(screen.getByRole('combobox',{name:'Notifications'}));
  await userEvent.click(screen.getByRole('option',{name:'Important updates only'}));
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,new_chat:false,thread:'target',notifications:'important'}}));
});
it('requires a thread when chat reuse is enabled and preserves legacy notification silence',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={()=>{}}/>);
  expect(screen.getByRole('combobox',{name:'Notifications'}).textContent).toContain('Off');
  await userEvent.click(screen.getByRole('switch',{name:'Start each run in a new chat'}));
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Choose the thread'));
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('switch',{name:'Start each run in a new chat'}));
  expect(screen.queryByRole('combobox',{name:'Runs in'})).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith('save_schedule',{schedule:{...schedule,new_chat:true,thread:null}}));
});

it('keeps deletion accessible while editing and cancels without saving or running',async()=>{
  const command=vi.fn(async()=>{}),onDeleted=vi.fn(),refresh=vi.fn(async()=>{});
  render(<ScheduleManager db={db} native command={command} onDeleted={onDeleted} onRefresh={refresh} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('button',{name:'Edit'}));
  await userEvent.click(screen.getByRole('button',{name:'Delete…'}));
  expect(screen.getByText(/Existing threads and their messages are kept/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:'Keep schedule'}));
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Delete…'}));
  await userEvent.click(screen.getByRole('button',{name:'Delete schedule'}));
  await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('schedule_action',{schedule:'s',action:'delete'}));
  expect(onDeleted).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button',{name:'Save schedule'})).toBeNull();
});
it('retains the schedule editor and reports a failed deletion',async()=>{
  const command=vi.fn(async()=>{throw new Error('Host unavailable');}),onDeleted=vi.fn();
  render(<ScheduleManager db={db} native command={command} scheduleId="s" onDeleted={onDeleted} onRefresh={async()=>{}} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('button',{name:'Delete…'}));
  await userEvent.click(screen.getByRole('button',{name:'Delete schedule'}));
  await waitFor(()=>expect(screen.getByText(/Host unavailable/)).toBeTruthy());
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('Weekly check')).toBeTruthy();
});

it('lets a routine save full access and shows every created thread',async()=>{
  const runs=Array.from({length:35},(_,i)=>({id:`r${i}`,due:i+1,state:'done',session:`t${i}`,reason:null}));
  const command=vi.fn(async()=>{}),onSelect=vi.fn();
  render(<ScheduleManager db={{...db,accounts:[{id:"removed-account",name:"Agent",provider:"codex"}],schedules:[{...schedule,runs}]}} native command={command} scheduleId="s" onRefresh={async()=>{}} onSelect={onSelect}/>);
  await userEvent.click(screen.getByRole('switch',{name:'Full access'}));
  await userEvent.click(screen.getByRole('button',{name:'Save schedule'}));
  expect(command).toHaveBeenCalledWith('save_schedule',{schedule:expect.objectContaining({options:{permission_mode:'bypass'}})});
  expect(screen.getByText(/35 runs · 35 threads/)).toBeTruthy();
  await userEvent.click(screen.getByText('Run history (35)'));
  expect(screen.getAllByRole('button',{name:'Open thread'})).toHaveLength(35);
});

it('keeps schedule defaults: Claude/Codex accounts start with full access, other accounts switch to ask, and no trigger warning appears',async()=>{
  const command=vi.fn(async()=>{});
  render(<ScheduleManager db={{...db,accounts:[{id:'c',name:'Claude',provider:'claude'},{id:'g',name:'Gem',provider:'gemini'}],schedules:[]}} native command={command} onRefresh={async()=>{}} onSelect={()=>{}}/>);
  await userEvent.click(screen.getByRole('button',{name:'New schedule'}));
  expect(screen.getByRole('switch',{name:'Full access'}).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByText(/Full access lets this agent act without asking/)).toBeNull();
  await userEvent.click(screen.getByRole('combobox',{name:'Schedule account'}));
  await userEvent.click(await screen.findByRole('option',{name:/Gem/}));
  expect(screen.getByRole('switch',{name:'Full access'}).getAttribute('aria-checked')).toBe('false');
});
