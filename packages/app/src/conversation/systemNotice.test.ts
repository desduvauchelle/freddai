import { expect, it } from 'vitest';
import { parseSystemNotice } from './systemNotice';

const light = 'Light notice (not a user message): these threads finished since the last notice. Skim them only if they matter; don\'t start new work just because of this.\n';

it('summarises a completion notice without ids', () => {
  const n = parseSystemNotice(`${light}- The iphone app has a blank screen, can… (2d67414b-1111-4222-8333-444455556666) ended done`);
  expect(n).toEqual({ kind: 'completion', summary: '1 thread finished: The iphone app has a blank screen, can… — done' });
  expect(n!.summary).not.toMatch(/2d67414b/);
});
it('counts additional completions', () => {
  const n = parseSystemNotice(`${light}- A (aaaaaaaa-1) ended done\n- B (bbbbbbbb-2) ended failed\n- C (cccccccc-3) ended done`);
  expect(n?.summary).toBe('3 threads finished: A — done (+2 more)');
});
it('summarises due and heartbeat notices', () => {
  expect(parseSystemNotice('Due notice (not a user message): these to-dos reached their due time.\n- Ship it (todo t1): due passed at 2026-01-01')?.summary).toBe('1 to-do due: Ship it');
  expect(parseSystemNotice('Heartbeat (scheduled check-in, not a user message). Review open to-dos.')).toEqual({ kind: 'heartbeat', summary: 'Scheduled check-in' });
});
it('leaves real user messages alone', () => {
  expect(parseSystemNotice('Light notice me later please')).toBeNull();
  expect(parseSystemNotice('hey, this is not a user message (just kidding)')).toBeNull();
  expect(parseSystemNotice('Start the thing\nLight notice (not a user message): x')).toBeNull();
});
