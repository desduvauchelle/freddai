import { expect, it } from 'vitest';
import { CONNECTION_GRACE_MS, classifyError, connectionReport, describeConnection, describeHistory, formatAgo, graceRemaining, initialConnectionStatus, onAttempt, onFailure, onSuccess, onTick, pollDelay, protocolDetail } from './connection-status';

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
  expect(step.transition).toEqual({ from: 'ok', to: 'down', reason: 'network-failure-persisted', error: 'latest', kind: 'network', failureCount: 3, attemptReason: 'poll' });
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

const down = (error = 'timeout') => onFailure(onFailure(ok(), error, 0).status, error, CONNECTION_GRACE_MS).status;

it('classifies protocol errors separately and extracts the specifics', () => {
  expect(classifyError('Invalid response from your Mac')).toBe('protocol');
  expect(classifyError('Invalid response from your Mac: HTTP 502 (text/html)')).toBe('protocol');
  expect(protocolDetail('Invalid response from your Mac: HTTP 502 (text/html)')).toBe('HTTP 502 (text/html)');
  expect(protocolDetail('Invalid response from your Mac')).toBe('');
  const info = describeConnection(down('Invalid response from your Mac: HTTP 502 (text/html)'));
  expect(info).toMatchObject({ title: "Can't reach your Mac", pair: false, details: 'HTTP 502 (text/html)' });
  expect(info.reason).toMatch(/Updating both apps/);
  expect(describeConnection(down('Relay unavailable')).reason).toMatch(/Freddai is open on your Mac/);
  expect(describeConnection(onFailure(ok(), 'Device revoked', 0).status).reason).toMatch(/pair again/);
});

it('tracks failure count, lastOkAt and clears the count on success', () => {
  let s = onSuccess(initialConnectionStatus, 500).status;
  expect(s.lastOkAt).toBe(500);
  s = onFailure(s, 'x', 1000).status; s = onFailure(s, 'x', 2000).status;
  expect(s.failureCount).toBe(2); expect(s.lastOkAt).toBe(500);
  s = onSuccess(s, 3000).status;
  expect(s).toMatchObject({ failureCount: 0, lastOkAt: 3000 });
});

it('backs off while failing and polls steadily when healthy', () => {
  const at = (failureCount: number) => pollDelay({ ...initialConnectionStatus, failureCount }, true);
  expect([0, 1, 2, 3, 4, 5, 9].map(at)).toEqual([1000, 1000, 2000, 5000, 10000, 15000, 15000]);
  expect(pollDelay({ ...initialConnectionStatus, failureCount: 0 }, false)).toBe(3000);
  expect(pollDelay({ ...initialConnectionStatus, failureCount: 1 }, false)).toBe(3000);
});

it('manual checks flag checking, record the outcome, and log the attempt reason', () => {
  const d = down();
  const started = onAttempt(d, 'manual', 20_000);
  expect(started).toMatchObject({ checking: true, lastAttemptAt: 20_000, attemptReason: 'manual', manualResult: null });
  const failed = onFailure(started, 'timeout', 21_000).status;
  expect(failed).toMatchObject({ checking: false, manualResult: 'failed', state: 'down' });
  const back = onSuccess(onAttempt(failed, 'manual', 22_000), 23_000);
  expect(back.status).toMatchObject({ state: 'ok', checking: false, manualResult: 'ok' });
  expect(back.transition).toMatchObject({ from: 'down', to: 'ok', attemptReason: 'manual', failureCount: 0 });
  expect(onAttempt(d, 'foreground', 5).checking).toBe(false);
});

it('never reports down during the grace period, including for protocol errors', () => {
  const s = onFailure(ok(), 'Invalid response from your Mac: HTTP 502', 0);
  expect(s.status.state).toBe('ok'); expect(s.transition).toBeUndefined();
  expect(onTick(s.status, CONNECTION_GRACE_MS).transition).toMatchObject({ to: 'down', kind: 'protocol' });
});

it('formats history and the copied report', () => {
  expect(formatAgo(0, 5_000)).toBe('just now');
  expect(formatAgo(0, 12 * 60_000)).toBe('12 min ago');
  expect(formatAgo(0, 3 * 3_600_000)).toBe('3 h ago');
  const s = { ...down(), lastOkAt: 0, failureCount: 5 };
  expect(describeHistory(s, 12 * 60_000)).toBe('Last connected 12 min ago · tried 5 times');
  expect(describeHistory({ ...s, lastOkAt: null, failureCount: 1 }, 0)).toBe('Not connected yet this session · tried 1 time');
  const report = connectionReport(s, 0);
  expect(report).toMatch(/error: timeout/); expect(report).toMatch(/kind: network/); expect(report).toMatch(/failureCount: 5/); expect(report).toMatch(/lastConnectedAt: 1970/);
});
