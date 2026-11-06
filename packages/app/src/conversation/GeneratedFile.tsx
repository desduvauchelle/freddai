import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@freddai/ui/components/dialog';
import type { ReactNode } from 'react';
import { MessageMarkdown } from './MessageMarkdown';

export type FileChunk = { mime: string; size: number; offset: number; data: string; path?: string; previewable?: boolean };
export type FileReader = (href: string, offset: number) => Promise<FileChunk>;
export const GeneratedFileContext = createContext<FileReader | undefined>(undefined);
/** Desktop only: validates a thread-referenced HTML file and returns a URL the browser panel can load, plus its absolute path. */
export type LocalPageResolver = (href: string) => Promise<{ url: string; path: string }>;
export const LocalPageContext = createContext<LocalPageResolver | undefined>(undefined);

/** True for any local file reference (relative, absolute, file:// or sandbox:), never for web, anchor or other-scheme links. */
export function isGeneratedFile(href: string) {
  const raw = href.replace(/^(file:\/\/|sandbox:)/i, '');
  if (/^#/.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || /^(javascript|data|blob):/i.test(href)) return false;
  return raw.includes('/') || /\.[a-z0-9]{1,8}$/i.test(raw);
}
export const isImageFile = (href: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(href);
export const isHtmlFile = (href: string) => /\.html?$/i.test(href);

const decodeBase64 = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
const utf8 = (parts: string[]) => new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(parts.join('')));
type Loaded = { kind: 'media'; mime: string; url: string } | { kind: 'text'; mime: string; text: string } | { kind: 'none' };

/** Reads a referenced file through the host in bounded chunks while `active`; releases the data when inactive. */
function useGeneratedFile(href: string, active: boolean) {
  const read = useContext(GeneratedFileContext);
  const reader = useRef(read);
  reader.current = read;
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) { setLoaded(undefined); setPath(''); setError(''); return; }
    let cancelled = false;
    setLoaded(undefined); setError('');
    void (async () => {
      const read = reader.current;
      if (!read) throw new Error('Open this conversation in a connected Freddai app to preview the file.');
      const chunks: string[] = [];
      let offset = 0;
      let first: FileChunk | undefined;
      while (!cancelled) {
        const part = await read(href, offset);
        first ??= part;
        if (part.offset !== offset || part.size !== first.size || part.mime !== first.mime || part.size > 25 * 1024 * 1024) throw new Error('File changed while loading. Close and try again.');
        if (part.path && !cancelled) setPath(part.path);
        if (part.previewable === false) { if (!cancelled) setLoaded({ kind: 'none' }); break; }
        const data = atob(part.data);
        if (!data.length || offset + data.length > part.size) throw new Error('Incomplete file preview.');
        chunks.push(part.data); offset += data.length;
        if (offset === part.size) {
          // Each transfer chunk is divisible by three, so base64 concatenation stays valid.
          if (cancelled) break;
          if (/^(text\/|application\/json$)/.test(part.mime)) setLoaded({ kind: 'text', mime: part.mime, text: utf8(chunks) });
          else setLoaded({ kind: 'media', mime: part.mime, url: `data:${part.mime};base64,${chunks.join('')}` });
          break;
        }
      }
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [active, href]);
  return { loaded, path, error, setError };
}

export function PathActions({ path }: { path: string }) {
  const [note, setNote] = useState('');
  const run = (action: () => Promise<unknown>, failure: string) => { setNote(''); void action().catch(e => setNote(`${failure}: ${String(e)}`)); };
  const native = isTauri();
  return <div className="generated-file-actions">
    <code>{path}</code>
    <button type="button" onClick={() => run(async () => { await navigator.clipboard.writeText(path); setNote('Path copied'); }, 'Could not copy the path')}>Copy path</button>
    {native && <button type="button" onClick={() => run(() => openPath(path), 'Could not open the file')}>Open in default app</button>}
    {native && <button type="button" onClick={() => run(() => revealItemInDir(path), 'Could not reveal the file')}>Reveal in Finder</button>}
    {note && <small role={note.startsWith('Path copied') ? 'status' : 'alert'}>{note}</small>}
  </div>;
}

/** Generic preview dialog for PDFs, text, sandboxed HTML (when no browser panel exists) and unpreviewable files. */
export function GeneratedFile({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { loaded, path, error, setError } = useGeneratedFile(href, open);
  const label = typeof children === 'string' ? children : 'Generated file';
  const preview = () => {
    if (error) return <p role="alert">{error}</p>;
    if (!loaded) return <p role="status">Loading preview…</p>;
    if (loaded.kind === 'none') return <p role="status">This file type cannot be previewed here.</p>;
    if (loaded.kind === 'media') return loaded.mime === 'application/pdf'
      ? <iframe title="PDF preview" src={loaded.url} className="generated-file-frame" />
      : <img src={loaded.url} alt={label} className="generated-file-image" onError={() => setError('The image could not be displayed.')} />;
    if (loaded.mime === 'text/html') return <iframe title="HTML preview" sandbox="" srcDoc={loaded.text} className="generated-file-frame generated-file-html" />;
    if (loaded.mime === 'text/markdown') return <div className="generated-file-markdown"><MessageMarkdown text={loaded.text} /></div>;
    return <pre className="generated-file-text">{loaded.text}</pre>;
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="generated-file-link">{children}</button></DialogTrigger>
    <DialogContent className="generated-file-dialog" onEscapeKeyDown={e => e.stopPropagation()}>
      <DialogHeader><DialogTitle>{href.split('/').pop() || 'Generated file'}</DialogTitle><DialogDescription>File preview from your Mac</DialogDescription></DialogHeader>
      {path && <PathActions path={path} />}
      {preview()}
    </DialogContent>
  </Dialog>;
}

/** Inline thumbnail that loads when scrolled into view and opens a full-viewport lightbox. */
export function InlineImage({ href, alt }: { href: string; alt: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (visible || !holder.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible]);
  const { loaded, path, error, setError } = useGeneratedFile(href, visible);
  const url = loaded?.kind === 'media' ? loaded.url : '';
  return <span ref={holder} className="generated-thumb">
    {error ? <span role="alert" className="generated-thumb-error">{alt || href}: {error}</span>
      : !url ? <span role="status" className="generated-thumb-loading">{loaded?.kind === 'none' ? `${alt || href} is not an image` : `Loading ${alt || 'image'}…`}</span>
      : <button type="button" className="generated-thumb-button" aria-label={`Open image: ${alt || href}`} onClick={() => setOpen(true)}>
        <img src={url} alt={alt} loading="lazy" onError={() => setError('The image could not be displayed.')} />
      </button>}
    {url && <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="generated-lightbox" onEscapeKeyDown={e => e.stopPropagation()}>
        <DialogHeader className="sr-only"><DialogTitle>{alt || href.split('/').pop() || 'Image'}</DialogTitle><DialogDescription>Image preview from your Mac</DialogDescription></DialogHeader>
        <div className="generated-lightbox-stage" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
          <img src={url} alt={alt} />
        </div>
        {path && <PathActions path={path} />}
      </DialogContent>
    </Dialog>}
  </span>;
}
