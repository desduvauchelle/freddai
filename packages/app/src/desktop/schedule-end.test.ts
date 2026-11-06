import { expect, it } from 'vitest';
import { dateInZone, endDateShortcut, scheduleEnded, startedRuns, runLimitReached } from './schedule-end';
it('uses the routine timezone for relative end dates',()=>{
  const now=new Date('2026-11-09T01:00:00Z');
  expect(dateInZone('America/Los_Angeles',now)).toBe('2026-11-08');
  expect(endDateShortcut('America/Los_Angeles','week',now)).toBe('2026-11-15');
  expect(endDateShortcut('UTC','week',now)).toBe('2026-11-16');
});
it('adds a calendar month and clamps the day at month end',()=>{
  expect(endDateShortcut('UTC','month',new Date('2026-01-31T12:00Z'))).toBe('2026-02-28');
  expect(endDateShortcut('UTC','month',new Date('2028-01-31T12:00Z'))).toBe('2028-02-29');
  expect(endDateShortcut('UTC','month',new Date('2026-12-15T12:00Z'))).toBe('2027-01-15');
});
it('distinguishes ended routines from paused unlimited routines',()=>{
  expect(scheduleEnded({end_date:'2000-01-01',timezone:'UTC',enabled:true,next_due:1})).toBe(true);
  expect(scheduleEnded({end_date:null,timezone:'UTC',enabled:false,next_due:0})).toBe(false);
});

it('counts started conversations, including failed and deleted threads, but not skipped attempts',()=>{
  const schedule={max_runs:2,runs:[
    {id:'a',due:1,state:'done',session:'deleted-thread',reason:null},
    {id:'b',due:2,state:'blocked',session:null,reason:'Missing account'},
    {id:'c',due:3,state:'failed',session:'failed-thread',reason:null},
    {id:'d',due:4,state:'missed',session:null,reason:null},
  ]};
  expect(startedRuns(schedule)).toBe(2);
  expect(runLimitReached(schedule)).toBe(true);
  expect(runLimitReached({...schedule,max_runs:3})).toBe(false);
  expect(runLimitReached({...schedule,max_runs:null})).toBe(false);
  expect(runLimitReached({max_runs:1,runs:[{id:'unknown',due:1,state:'uncertain',session:null,reason:null}]})).toBe(true);
});
