import { useEffect, useRef, useState } from 'react';
import { localDateKey, type DaySummariesClient, type DaySummaryState } from '../desktop/DaySummaries';
import type { NativeSummary } from './native-dashboard';

/** Cached reads only. Generation is exclusively a native button action. */
export function useNativeSummaries(client: DaySummariesClient | undefined, enabled: boolean) {
  const [states, setStates] = useState<Record<string, DaySummaryState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const today = localDateKey(new Date());
  const dates = [0, 1, 2].map(back => {
    const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() - back);
    return { date: localDateKey(date), label: back === 0 ? 'Today' : back === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) };
  });
  useEffect(() => {
    const token = ++generation.current;
    setStates({}); setErrors({}); setBusy({});
    if (!enabled || !client) return;
    const read = async () => {
      await Promise.all(dates.map(async ({ date }) => {
        try {
          const state = await client.get(date);
          if (generation.current === token) { setStates(old => ({ ...old, [date]: state })); setErrors(old => ({ ...old, [date]: '' })); }
        } catch (error) { if (generation.current === token) setErrors(old => ({ ...old, [date]: String(error) })); }
      }));
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => { generation.current++; clearInterval(timer); };
  // The date keys are derived from today; polling never invokes generate.
  }, [client, enabled, today]);
  const summaries: NativeSummary[] = !enabled || !client ? [] : dates.map(({ date, label }) => {
    const state = states[date], summary = state?.summary;
    const running = !!busy[date] || !!state?.running;
    const error = errors[date] || state?.error?.reason;
    return { date, label, busy: running,
      text: error ? `Summary failed: ${error}` : summary?.markdown ?? (running ? 'Generating…' : !state ? 'Loading…' : !state.threads ? 'No activity' : 'Not generated. Generating uses your agent subscription.'),
      action: state && (summary || state.threads > 0) ? running ? 'Generating…' : summary ? 'Refresh' : 'Generate' : null };
  });
  async function generate(date: string) {
    if (!enabled || !client || !dates.some(d => d.date === date) || busy[date] || states[date]?.running) return;
    const token = generation.current;
    setBusy(old => ({ ...old, [date]: true }));
    try {
      const state = await client.generate(date, !!states[date]?.summary);
      if (generation.current === token) { setStates(old => ({ ...old, [date]: state })); setErrors(old => ({ ...old, [date]: '' })); }
    } catch (error) { if (generation.current === token) setErrors(old => ({ ...old, [date]: String(error) })); }
    finally { if (generation.current === token) setBusy(old => ({ ...old, [date]: false })); }
  }
  return { summaries, generate };
}
