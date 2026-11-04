import { useCallback, useEffect, useRef, useState } from 'react';
import { graceRemaining, initialConnectionStatus, onFailure, onSuccess, onTick, type ConnectionStatus, type ConnectionStep } from './connection-status';

/** React binding for the connection state machine; logs every state transition. */
export function useConnectionStatus(now: () => number = Date.now) {
  const [status, setStatus] = useState<ConnectionStatus>(initialConnectionStatus);
  const current = useRef(status);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useRef(now);
  clock.current = now;
  const apply = useCallback((step: ConnectionStep) => {
    current.current = step.status;
    if (step.transition) console.info('[companion-connection]', step.transition);
    setStatus(step.status);
    clearTimeout(timer.current);
    const wait = graceRemaining(step.status, clock.current());
    // A hanging request must not stretch the deadline: re-check when the grace period ends.
    if (wait !== null) timer.current = setTimeout(() => apply(onTick(current.current, clock.current())), wait);
  }, []);
  const succeeded = useCallback(() => apply(onSuccess(current.current)), [apply]);
  const failed = useCallback((error: string) => apply(onFailure(current.current, error, clock.current())), [apply]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { status, connected: status.state === 'ok', down: status.state === 'down', succeeded, failed };
}
