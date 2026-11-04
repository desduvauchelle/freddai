import { expect, it as test } from 'vitest';
import { wakeAndWait, type WakeState } from './WakeMac';
import type { CompanionClient } from './companion';
const run = async (client: Partial<CompanionClient>, wait = 40, poll = 5) => {
  const states: WakeState[] = [];
  await wakeAndWait(client as CompanionClient, s => states.push(s), new AbortController().signal, wait, poll);
  return states.map(s => s.phase);
};
test('wake reports awake once the Mac answers', async () => {
  let calls = 0;
  expect(await run({ wake: async () => 3, snapshot: async () => { if (++calls < 2) throw new Error('down'); return {} as never; } })).toEqual(['sending', 'waiting', 'awake']);
});
test('wake fails loudly when sending fails or the Mac never answers', async () => {
  expect(await run({ wake: async () => { throw new Error('no network'); } })).toEqual(['sending', 'failed']);
  expect(await run({ wake: async () => 1, snapshot: async () => { throw new Error('down'); } })).toEqual(['sending', 'waiting', 'failed']);
});
