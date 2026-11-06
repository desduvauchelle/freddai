import { expect, it } from 'vitest';
import { recurrenceCron } from './schedule-recurrence';
it('converts explicit daily and weekly times without guessing', () => {
  expect(recurrenceCron('every weekday at 9 AM')).toBe('0 9 * * 1-5');
  expect(recurrenceCron('every day at 12:30 pm')).toBe('30 12 * * *');
  expect(recurrenceCron('Monday at 00:15')).toBe('15 0 * * 1');
  expect(recurrenceCron('daily at 12 am')).toBe('0 0 * * *');
  for (const text of ['tomorrow morning','daily at 25:00','daily at 9:99','daily at 0 am','delete my task']) expect(recurrenceCron(text)).toBeNull();
});
