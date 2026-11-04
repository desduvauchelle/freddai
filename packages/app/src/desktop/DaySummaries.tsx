import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { MessageMarkdown } from "../conversation/MessageMarkdown";
import "./day-summaries.css";

export interface DaySummary { date: string; markdown: string; generated_at: number; provider: string; account: string; model: string; threads: number }
export interface DaySummaryState {
  date: string;
  summary: DaySummary | null;
  running: boolean;
  error: { code: string; reason: string; at: number } | null;
  threads: number;
}
/** `get` only reads cache/status; only `generate` spends provider quota, and only when clicked. */
export interface DaySummariesClient {
  get(date: string): Promise<DaySummaryState>;
  generate(date: string, force: boolean): Promise<DaySummaryState>;
}
export const hostDaySummariesClient: DaySummariesClient = {
  get: date => invoke<DaySummaryState>("day_summary", { date }),
  generate: (date, force) => invoke<DaySummaryState>("summarize_day", { date, force }),
};

const pad = (n: number) => String(n).padStart(2, "0");
export const localDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function days(today: Date) {
  const at = (back: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  const third = at(2);
  return [
    { date: localDateKey(at(0)), label: "Today" },
    { date: localDateKey(at(1)), label: "Yesterday" },
    { date: localDateKey(third), label: third.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) },
  ];
}
const rawMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** An older background host that predates this command is a version mismatch, not a summary failure. */
const message = (e: unknown) => {
  const raw = rawMessage(e);
  return raw.includes("Unknown host command")
    ? `The background host is older than this app (${raw}). Save your draft and let active work finish, then quit and reopen Freddai.`
    : raw;
};

function DaySection({ date, label, client, defaultOpen }: { date: string; label: string; client: DaySummariesClient; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<DaySummaryState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((next: DaySummaryState) => { if (alive.current) { setState(next); setFailure(null); } }, []);
  useEffect(() => { client.get(date).then(apply, e => alive.current && setFailure(message(e))); }, [client, date, apply]);
  // The host generates on a background thread; polling reads status only and never starts a provider call.
  useEffect(() => {
    if (!state?.running) return;
    const timer = setInterval(() => { client.get(date).then(apply, e => alive.current && setFailure(message(e))); }, 2000);
    return () => clearInterval(timer);
  }, [client, date, state?.running, apply]);

  const generate = async () => {
    setBusy(true); setFailure(null);
    try { apply(await client.generate(date, !!state?.summary)); }
    catch (e) { if (alive.current) setFailure(message(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const running = busy || !!state?.running;
  const summary = state?.summary ?? null;
  const error = failure ?? (state?.error ? `${state.error.reason} (${state.error.code})` : null);
  const empty = state !== null && state.threads === 0 && !summary;

  return (
    <section className="day-summary" data-date={date}>
      <header className="day-summary-head">
        <button type="button" className="day-summary-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
          <span className="day-summary-label">{label}</span>
          {state && state.threads > 0 && <span className="day-summary-count">{state.threads} {state.threads === 1 ? "thread" : "threads"}</span>}
        </button>
        {summary && <span className="day-summary-meta">generated {clock(summary.generated_at)} by {summary.provider}</span>}
        {!empty && state && (
          <button type="button" className="day-summary-action" disabled={running} onClick={() => void generate()} aria-label={`${summary ? "Refresh" : "Generate"} summary for ${label}`}>
            <RefreshCw size={12} className={running ? "day-summary-spin" : undefined}/>{running ? "Generating…" : summary ? "Refresh" : "Generate"}
          </button>
        )}
      </header>
      {open && (
        <div className="day-summary-body">
          {error && <p className="day-summary-error" role="alert">Summary failed: {error}</p>}
          {state === null && !failure && <p className="day-summary-muted">Loading…</p>}
          {empty && <p className="day-summary-muted">No activity</p>}
          {summary && <div className="day-summary-md"><MessageMarkdown text={summary.markdown}/></div>}
          {state && !summary && !empty && !running && !error && <p className="day-summary-muted">Not generated. Generating uses your agent subscription.</p>}
          {running && !summary && <p className="day-summary-muted">Generating…</p>}
        </div>
      )}
    </section>
  );
}

export function DaySummaries({ client = hostDaySummariesClient, now }: { client?: DaySummariesClient; now?: Date } = {}) {
  const list = useMemo(() => days(now ?? new Date()), [now]);
  return (
    <div className="day-summaries" aria-label="Daily summaries">
      {list.map((d, i) => <DaySection key={d.date} date={d.date} label={d.label} client={client} defaultOpen={i === 0}/>)}
    </div>
  );
}
