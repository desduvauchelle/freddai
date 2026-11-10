import { createContext, useContext, useState } from 'react';

/** Companion-only host hook: opens a Mac localhost URL as a native preview. Absent on desktop and standalone transcripts, so no chip renders. Rejects with an error string. */
export const PreviewContext = createContext<((url: string) => Promise<void>) | null>(null);

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s<>"'`)\]]*/gi;

/** Normalizes a localhost-style URL to `http(s)://localhost:<port>/path`, or undefined when it is not one or the port is invalid. */
export function normalizeLocalhostUrl(raw: string): { url: string; port: number; key: string } | undefined {
  let u: URL;
  try { u = new URL(raw.replace(/[.,;:!?]+$/, '')); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (!['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)) return undefined;
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { url: `${u.protocol}//localhost:${port}${u.pathname}${u.search}${u.hash}`, port, key: `${port}${u.pathname}${u.search}` };
}

/** Distinct localhost previews in a message: one per port+path(+query). */
export function localhostPreviewUrls(text: string): string[] {
  const seen = new Map<string, string>();
  for (const m of text.match(LOCAL_URL) ?? []) {
    const n = normalizeLocalhostUrl(m);
    if (n && !seen.has(n.key)) seen.set(n.key, n.url);
  }
  return [...seen.values()];
}

function PreviewChip({ url, open }: { url: string; open: (url: string) => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const label = url.replace(/^https?:\/\//, '');
  return <span className="preview-chip-wrap">
    <button type="button" className="preview-chip" disabled={busy} title={`Preview ${url}`} aria-label={`Preview ${label}`} onClick={() => {
      setError(''); setBusy(true);
      open(url).catch(e => {
        console.error('preview_open_failed', { url, error: e });
        setError(`Preview failed: ${e instanceof Error ? e.message : String(e)}`);
      }).finally(() => setBusy(false));
    }}>Preview <span>{label}</span></button>
    {error && <span className="preview-chip-error" role="alert">{error}</span>}
  </span>;
}

/** Chips for localhost links in one message. Renders nothing without a companion preview host. */
export function LocalhostPreviewChips({ text }: { text: string }) {
  const open = useContext(PreviewContext);
  if (!open) return null;
  const urls = localhostPreviewUrls(text);
  if (!urls.length) return null;
  return <div className="preview-chips">{urls.map(url => <PreviewChip key={url} url={url} open={open} />)}</div>;
}
