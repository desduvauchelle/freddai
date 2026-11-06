import { expect, it } from 'vitest';
import { readSchedule, scheduleCron } from './schedule-controls';
it('round trips supported recurrence without shifting times or days',()=>{
  for(const cron of ['30 14 * * *','0 9 * * 1-5','15 8 * * 0','0 0 31 * *','0 9 * * 1,3,5','30 15 * * 1,2,4']) {
    const {repeat,time,day}=readSchedule(cron);
    expect(repeat).not.toBe('custom');
    if(repeat!=='custom') expect(scheduleCron(repeat,time,day)).toBe(cron);
  }
});
it('keeps unsupported schedules custom and accepts Sunday 7',()=>{
  for(const cron of ['*/15 * * * *','0 9 * * MON-FRI','0 8 1 6 *']) expect(readSchedule(cron).repeat).toBe('custom');
  expect(readSchedule('0 9 * * 7')).toEqual({repeat:'weekly',time:'09:00',day:'0'});
});
