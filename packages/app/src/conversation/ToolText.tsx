import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Message } from '../desktop/types';

export type ToolTextPage = { text: string; offset: number; nextOffset: number | null; totalBytes: number; hash: string };
export type ToolTextReader = (message: string, offset: number, hash?: string) => Promise<ToolTextPage>;
export const ToolTextContext = createContext<ToolTextReader | undefined>(undefined);

/** Holds one bounded page only. Closing the disclosure releases output and requests. */
export function ToolText({ call }: { call: Message }) {
  const reader = useContext(ToolTextContext);
  const readerRef = useRef(reader);
  readerRef.current = reader;
  const [offsets, setOffsets] = useState([0]);
  const [page, setPage] = useState<ToolTextPage | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const offset = offsets[offsets.length - 1];
  useEffect(() => {
    let disposed = false;
    setPage(null); setError('');
    const read = readerRef.current;
    if (!read) { setError('Tool details are unavailable in this window.'); return; }
    void read(call.id, offset, call.toolTextHash).then(result => {
      if (!disposed) setPage(result);
    }, reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [call.id, call.toolTextHash, offset, retry]);
  return <>
    {error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      : !page ? <div role="status">Loading tool output…</div> : <pre>{page.text}</pre>}
    <div className="tool-output-pages">
      {offsets.length > 1 && <button type="button" onClick={() => setOffsets(values => values.slice(0, -1))}>Previous output</button>}
      {page?.nextOffset != null && <button type="button" onClick={() => setOffsets(values => [...values, page.nextOffset!])}>More output</button>}
    </div>
  </>;
}
