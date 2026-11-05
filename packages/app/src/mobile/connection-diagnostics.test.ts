import { beforeEach, expect, it } from 'vitest';
import { connectionHistory, recordConnection } from './connection-diagnostics';
import { initialConnectionStatus, onFailure } from './connection-status';
beforeEach(() => localStorage.clear());
it('retains bounded metadata across failures and recovery without error payloads', () => {
  const status = onFailure(initialConnectionStatus, 'private payload', 100).status;
  for (let n = 0; n < 110; n++) recordConnection(status, 'failure', 100 + n);
  recordConnection(status, 'recovered', 300);
  const history = JSON.parse(connectionHistory());
  expect(history).toHaveLength(100);
  expect(history.at(-1)).toMatchObject({ event: 'recovered', outageMs: 200, failures: 1 });
  expect(connectionHistory()).not.toContain('private payload');
});
