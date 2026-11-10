import { describe, expect, it, afterEach } from 'vitest';
import { retryableDelivery, readOutbox, saveOutbox, retryDelayMs, queuedStatus } from './outbox';
afterEach(() => localStorage.clear());
describe('outbox transport policy', () => {
  it.each(['Relay unavailable. Check your internet connection.', 'Connection interrupted. Check the conversation before retrying.', 'Your Mac did not respond through the relay in time.', 'Host is upgrading. Try again shortly.'])('retries %s', error => expect(retryableDelivery(error)).toBe(true));
  it.each(['Device revoked', 'Pair this phone again', 'Account not found', 'Thread unavailable', 'Reply rejected', 'Invalid relay response'])('returns %s to the composer', error => expect(retryableDelivery(error)).toBe(false));
  it('isolates queues when pairing changes without deleting the previous queue', () => {
    saveOutbox([{ id: 'original' } as never]);
    localStorage.setItem('freddai.companion.outboxScope', 'new-pairing');
    expect(readOutbox()).toEqual([]);
    saveOutbox([{ id: 'new' } as never]);
    localStorage.removeItem('freddai.companion.outboxScope');
    expect(readOutbox()[0].id).toBe('original');
  });
});


it('migrates acknowledged legacy entries out of the durable delivery backlog', () => {
  localStorage.setItem('freddai.companion.outbox.v1', JSON.stringify([
    { id: 'delivered', acknowledged: true }, { id: 'unsent', acknowledged: false },
  ]));
  expect(readOutbox().map(item => item.id)).toEqual(['unsent']);
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]').map((item: { id: string }) => item.id)).toEqual(['unsent']);
});


it('persists only messages still awaiting host acceptance', () => {
  saveOutbox([{ id: 'sent', acknowledged: true } as never, { id: 'pending', acknowledged: false } as never]);
  expect(readOutbox().map(item => item.id)).toEqual(['pending']);
});


it('backs off 2s to a 30s cap', () => {
  expect([1, 2, 3, 4, 5, 6, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

it('names the last failure and the next attempt in the queued status', () => {
  expect(queuedStatus({}, false, 0)).toBe('◷ Queued · waiting for connection');
  expect(queuedStatus({ deliveryError: 'Relay unavailable', retryAt: 8_000 }, true, 0)).toBe('◷ Queued · last attempt failed: Relay unavailable · retrying in 8s');
  expect(queuedStatus({ deliveryError: 'Relay unavailable', retryAt: 1 }, true, 5_000)).toContain('retrying now');
  expect(queuedStatus({ deliveryError: 'Relay unavailable', retryAt: 8_000 }, false, 0)).toContain('waiting for connection');
});
