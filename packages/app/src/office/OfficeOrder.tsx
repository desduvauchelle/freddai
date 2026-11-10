import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Release dispatches only this recording; retries keep the same request id. */
export function OfficeOrder({ disabled, onSend, renderMic }: {
  disabled: boolean;
  onSend: (text: string, requestId: string) => Promise<unknown>;
  renderMic: (onText: (text: string) => void, disabled: boolean) => ReactNode;
}) {
  const alive = useRef(true), sending = useRef(false);
  const [pending, setPending] = useState<{ text: string; id: string } | null>(null);
  const [state, setState] = useState(''), [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function send(order: { text: string; id: string }) {
    if (!alive.current || sending.current || disabled) return;
    sending.current = true; setPending(order); setError(''); setState('Starting task…');
    try {
      await onSend(order.text, order.id);
      if (alive.current) { setPending(null); setState('Task started'); }
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setState(''); }
    } finally { sending.current = false; }
  }
  return <div className="office-order-controls">
    <span>Hold to give an order · release to start · move away to cancel</span>
    {renderMic(text => { if (text.trim()) void send({ text: text.trim(), id: crypto.randomUUID() }); }, disabled || !!pending)}
    {state && <span role="status">{state}</span>}
    {error && <div role="alert"><p>{error}</p><p>{pending?.text}</p><button type="button" disabled={disabled} onClick={() => { if (pending) void send(pending); }}>Retry order</button></div>}
  </div>;
}
