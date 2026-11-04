import { useCallback, useEffect, useRef, useState } from 'react';
import { graceRemaining, initialConnectionStatus, onAttempt, onFailure, onSuccess, onTick, pollDelay, type AttemptReason, type ConnectionStatus, type ConnectionStep } from './connection-status';

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
  const attempt = useCallback((reason: AttemptReason) => apply({ status: onAttempt(current.current, reason, clock.current()) }), [apply]);
  const succeeded = useCallback(() => apply(onSuccess(current.current, clock.current())), [apply]);
  const failed = useCallback((error: string) => apply(onFailure(current.current, error, clock.current())), [apply]);
  /** Delay before the next poll, from the latest status (backs off while the Mac is unreachable). */
  const nextDelay = useCallback((visible: boolean) => pollDelay(current.current, visible), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { status, connected: status.state === 'ok', down: status.state === 'down', attempt, succeeded, failed, nextDelay };
}
