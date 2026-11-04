import { expect, it } from 'vitest';
import { CONNECTION_GRACE_MS, classifyError, describeConnection, graceRemaining, initialConnectionStatus, onFailure, onSuccess, onTick } from './connection-status';

const ok = () => onSuccess(initialConnectionStatus).status;

it('stays green through a brief network blip and recovers', () => {
  let s = ok();
  const f = onFailure(s, 'Connection interrupted', 1_000);
  expect(f.status.state).toBe('ok'); expect(f.transition).toBeUndefined();
  s = onFailure(f.status, 'Connection interrupted', 1_000 + CONNECTION_GRACE_MS - 1).status;
  expect(s.state).toBe('ok');
  const back = onSuccess(s);
  expect(back.status).toMatchObject({ state: 'ok', firstFailureAt: null, error: '' });
  // a later blip restarts the clock rather than inheriting the old one
  expect(onFailure(back.status, 'x', 1_000 + CONNECTION_GRACE_MS + 5_000).status.state).toBe('ok');
});

it('turns red once failures persist for the grace period, measured from the first failure', () => {
  let s = ok();
  s = onFailure(s, 'timeout', 0).status;
  s = onFailure(s, 'timeout', 5_000).status;
  expect(s.state).toBe('ok');
  const step = onFailure(s, 'latest', CONNECTION_GRACE_MS);
  expect(step.status).toMatchObject({ state: 'down', kind: 'network', error: 'latest' });
  expect(step.transition).toEqual({ from: 'ok', to: 'down', reason: 'network-failure-persisted', error: 'latest' });
});

it('turns red from a timer tick when no further failure arrives (hanging request)', () => {
  const s = onFailure(ok(), 'timeout', 0).status;
  expect(graceRemaining(s, 4_000)).toBe(CONNECTION_GRACE_MS - 4_000);
  expect(onTick(s, CONNECTION_GRACE_MS - 1).status.state).toBe('ok');
  expect(onTick(s, CONNECTION_GRACE_MS).status.state).toBe('down');
});

it('recovers to green immediately on success', () => {
  const down = onFailure(onFailure(ok(), 'timeout', 0).status, 'timeout', CONNECTION_GRACE_MS).status;
  const step = onSuccess(down);
  expect(step.status.state).toBe('ok');
  expect(step.transition).toMatchObject({ from: 'down', to: 'ok', reason: 'snapshot-ok' });
});

it('turns red immediately for auth/pairing errors', () => {
  for (const error of ['Device revoked', 'Pair this iPhone in Freddai settings on your Mac.', 'Cannot read saved pairing credentials']) {
    const step = onFailure(ok(), error, 0);
    expect(step.status).toMatchObject({ state: 'down', kind: 'auth' });
    expect(step.transition?.reason).toBe('auth-error');
    expect(describeConnection(step.status).pair).toBe(true);
  }
});

it('classifies network-type errors as retryable', () => {
  for (const error of ['Mac unreachable. Configure a relay in Mac settings', 'Relay unavailable', 'Unlock your iPhone to read its pairing credentials', 'Your Mac is offline or the device was revoked. Keep the Mac awake']) expect(classifyError(error)).toBe('network');
  expect(describeConnection(onFailure(ok(), 'x', 0).status).title).toMatch(/Can't reach your Mac/);
});

it('applies the grace period before the first success too', () => {
  const s = onFailure(initialConnectionStatus, 'Relay unavailable', 0);
  expect(s.status.state).toBe('connecting');
  expect(onTick(s.status, CONNECTION_GRACE_MS).transition).toMatchObject({ from: 'connecting', to: 'down' });
});
