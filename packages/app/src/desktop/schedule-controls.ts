export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
export function readSchedule(cron: string): { repeat: Repeat; time: string; day: string } {
  const [minute, hour, date, month, weekday] = cron.split(/\s+/);
  const time = /^\d+$/.test(hour || '') && /^\d+$/.test(minute || '') ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : '09:00';
  if (!/^\d+$/.test(hour || '') || !/^\d+$/.test(minute || '') || month !== '*') return {repeat:'custom',time,day:'1'};
  if (date === '*' && weekday === '*') return {repeat:'daily',time,day:'1'};
  if (date === '*' && weekday === '1-5') return {repeat:'weekdays',time,day:'1'};
  if (date === '*' && /^[0-7](,[0-7])*$/.test(weekday)) return {repeat:'weekly',time,day:[...new Set(weekday.split(',').map(d=>String(Number(d)%7)))].join(',')};
  if (/^\d+$/.test(date) && weekday === '*') return {repeat:'monthly',time,day:date};
  return {repeat:'custom',time,day:'1'};
}
export function scheduleCron(repeat: Exclude<Repeat,'custom'>, time: string, day: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} ${repeat === 'monthly' ? day : '*'} * ${repeat === 'weekly' ? day : repeat === 'weekdays' ? '1-5' : '*'}`;
}
