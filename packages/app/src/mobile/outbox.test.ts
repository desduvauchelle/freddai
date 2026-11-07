import { describe, expect, it, afterEach } from 'vitest';
import { retryableDelivery, readOutbox, saveOutbox } from './outbox';
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
