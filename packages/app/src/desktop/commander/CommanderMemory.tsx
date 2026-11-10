import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Pin, PinOff } from "lucide-react";
import { commanderApi, type Memory } from "./api";

export const msg = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Loads a list once on mount; exposes loud errors and a reload. */
export function useLoad<T>(load: () => Promise<T>, empty: T) {
  const [value, setValue] = useState<T>(empty), [error, setError] = useState("");
  const reload = useCallback(async () => { try { setValue(await load()); setError(""); } catch (e) { setError(msg(e)); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);
  return { value, error, reload };
}

export function MemoryTab() {
  const mem = useLoad<Memory[]>(() => commanderApi.memory(), []);
  const [error, setError] = useState("");
  async function patch(m: Memory, p: Partial<Memory>) {
    setError("");
    try { await commanderApi.memorySave({ id: m.id, ...p }); await mem.reload(); } catch (e) { setError(`Couldn't update memory: ${msg(e)}`); }
  }
  const items = mem.value.filter(m => m.status !== "forgotten" && !m.superseded_by).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return <div className="commander-stack">
    {(error || mem.error) && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error || mem.error}</p>}
    {!items.length && !mem.error && <p className="commander-empty">Commander hasn't remembered anything yet.</p>}
    <ul className="commander-list">{items.map(m => <li key={m.id} className="commander-memory" data-status={m.status}>
      <div><span className="commander-chip" data-muted>{m.kind}</span>{m.status === "stale" && <span className="commander-chip" data-muted>stale</span>}<p>{m.text}</p></div>
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="ghost" aria-pressed={m.pinned} aria-label={`${m.pinned ? "Unpin" : "Pin"} memory: ${m.text}`} onClick={() => void patch(m, { pinned: !m.pinned })}>{m.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}{m.pinned ? "Unpin" : "Pin"}</button>
        <button type="button" className="commander-btn" data-variant="no" aria-label={`Forget memory: ${m.text}`} onClick={() => void patch(m, { status: "forgotten" })}>Forget</button>
      </div>
    </li>)}</ul>
  </div>;
}
