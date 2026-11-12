import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** Host hook: opens a Mac localhost URL as a preview (phone: native preview; desktop: side panel). Absent on standalone transcripts, so no chip renders. Rejects with `"<code>: <detail>"`. */
export type PreviewOpen = (url: string, opts?: { start?: boolean }) => Promise<void>;
export const PreviewContext = createContext<PreviewOpen | null>(null);

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s<>"'`)\]]*/gi;

/** Normalizes a localhost-style URL to `http(s)://localhost:<port>/path`, or undefined when it is not one or the port is invalid. */
export function normalizeLocalhostUrl(raw: string): { url: string; port: number; key: string } | undefined {
  let u: URL;
  try { u = new URL(raw.replace(/[.,;:!?]+$/, '')); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (!['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)) return undefined;
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
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

/** Splits a host rejection `"<code>: <detail>"` or bare `"<code>"`. Non-string errors become `preview_failed`. */
export function parsePreviewError(e: unknown): { code: string; detail: string } {
  if (e instanceof Error && /^preview_\w+(: |$)/.test(e.message)) e = e.message; // desktop provider throws Errors carrying a code
  if (typeof e !== 'string') return { code: 'preview_failed', detail: e instanceof Error ? e.message : String(e) };
  const i = e.indexOf(': ');
  return i < 0 ? { code: e, detail: '' } : { code: e.slice(0, i), detail: e.slice(i + 2) };
}

export function describePreviewError(code: string, detail: string, label: string): string {
  switch (code) {
    case 'preview_server_starting': return `Starting the server on ${label}…`;
    case 'preview_server_confirm': return `Nothing is listening on ${label}. Start it?`;
    case 'preview_start_timeout': return `The server for ${label} did not start within ${detail} s.`;
    case 'preview_server_failed': return `The server for ${label} exited. ${detail}`;
    case 'preview_port_unreachable': return `Nothing is listening on ${label}. Ask the agent to start the server, or to share it with a start command.`;
    case 'preview_not_granted': return `${label} was not shared in this thread.`;
    case 'preview_tunnel_unavailable': return `Could not reach the Freddai relay. ${detail}`;
    default: return `Preview failed: ${code}${detail ? ` (${detail})` : ''}`;
  }
}

/** Inline failure text plus the raw code, always visible for diagnosis. */
export function PreviewErrorText({ code, detail, label }: { code: string; detail: string; label: string }) {
  return <span className="preview-chip-error" role="alert">{describePreviewError(code, detail, label)} <code className="preview-chip-code">{code}</code></span>;
}

const DEFAULT_RETRY = { intervalMs: 2000, totalMs: 90000 };
export type PreviewRetry = { intervalMs: number; totalMs: number };

/** `preview_server_confirm` detail is `<command> @ <cwd>`; split on the last ` @ `. */
export function parseConfirmDetail(detail: string): { command: string; cwd: string } {
  const i = detail.lastIndexOf(' @ ');
  return i < 0 ? { command: detail, cwd: '' } : { command: detail.slice(0, i), cwd: detail.slice(i + 3) };
}

/** Replaces a leading home directory (/Users/x, /home/x) with `~`. */
export function shortenHome(path: string): string {
  return path.replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, '~');
}

export type LocalhostPreview = {
  state: 'idle' | 'busy' | 'starting';
  error: { code: string; detail: string } | null;
  confirm: { command: string; cwd: string } | null;
  /** Opens, asking the Mac to start the server after the user confirmed. */
  start: () => void;
  /** Opens without starting anything; a stopped server yields `confirm`. */
  click: () => void;
};

/** Open + retry-while-starting + confirm state, shared by the Preview chip and localhost links. */
export function useLocalhostPreview(url: string, open: PreviewOpen, retry: PreviewRetry = DEFAULT_RETRY): LocalhostPreview {
  const [error, setError] = useState<{ code: string; detail: string } | null>(null);
  const [confirm, setConfirm] = useState<{ command: string; cwd: string } | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'starting'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  const attempt = (startedAt: number, start: boolean) => {
    (start ? open(url, { start: true }) : open(url)).then(() => { if (alive.current) setState('idle'); }, e => {
      if (!alive.current) return;
      const parsed = parsePreviewError(e);
      if (parsed.code === 'preview_server_confirm') { setState('idle'); setConfirm(parseConfirmDetail(parsed.detail)); return; }
      if (parsed.code === 'preview_server_starting') {
        if (Date.now() - startedAt + retry.intervalMs < retry.totalMs) {
          setState('starting');
          timer.current = setTimeout(() => attempt(startedAt, start), retry.intervalMs);
          return;
        }
        console.error('preview_open_failed', { url, error: e });
        setState('idle'); setError({ code: 'preview_start_timeout', detail: String(Math.round(retry.totalMs / 1000)) });
        return;
      }
      console.error('preview_open_failed', { url, error: e });
      setState('idle'); setError(parsed);
    });
  };
  const run = (start: boolean) => { clearTimeout(timer.current); setError(null); setConfirm(null); setState('busy'); attempt(Date.now(), start); };
  return { state, error, confirm, start: () => run(true), click: () => run(false) };
}

/** Confirmation line: asks before Freddai runs the share's start command on the Mac. */
export function PreviewConfirm({ label, confirm, onStart }: { label: string; confirm: { command: string; cwd: string }; onStart: () => void }) {
  return <span className="preview-chip-confirm" role="alert">
    {describePreviewError('preview_server_confirm', '', label)} <code className="preview-chip-command">{confirm.command}</code>
    {confirm.cwd && <span className="preview-chip-cwd"> in {shortenHome(confirm.cwd)}</span>}
    {' '}<button type="button" className="preview-chip-start" aria-label={`Start server for ${label}`} onClick={onStart}>Start server</button>
    {' '}<code className="preview-chip-code">preview_server_confirm</code>
  </span>;
}

function PreviewChip({ url, open, retry }: { url: string; open: PreviewOpen; retry: PreviewRetry }) {
  const p = useLocalhostPreview(url, open, retry);
  const label = url.replace(/^https?:\/\//, '');
  const starting = p.state === 'starting';
  return <span className="preview-chip-wrap">
    <button type="button" className="preview-chip" disabled={p.state !== 'idle'} title={`Preview ${url}`} aria-label={`Preview ${label}`} onClick={p.click}>{starting ? 'Starting ' : 'Preview '}<span>{label}</span>{starting && '…'}</button>
    {starting && <span className="preview-chip-status" role="status">{describePreviewError('preview_server_starting', '', label)}</span>}
    {p.confirm && <PreviewConfirm label={label} confirm={p.confirm} onStart={p.start} />}
    {p.error && <PreviewErrorText code={p.error.code} detail={p.error.detail} label={label} />}
  </span>;
}

/** Chips for localhost links in one message. Renders nothing without a companion preview host. */
export function LocalhostPreviewChips({ text, retry = DEFAULT_RETRY }: { text: string; retry?: PreviewRetry }) {
  const open = useContext(PreviewContext);
  if (!open) return null;
  const urls = localhostPreviewUrls(text);
  if (!urls.length) return null;
  return <div className="preview-chips">{urls.map(url => <PreviewChip key={url} url={url} open={open} retry={retry} />)}</div>;
}
