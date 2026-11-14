import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useSatelliteMode } from '../desktop/satellite';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@freddai/ui/components/dialog';
import type { ReactNode } from 'react';
import { MessageMarkdown } from './MessageMarkdown';
import './InlineMedia.css';

export type FileChunk = { mime: string; size: number; offset: number; data: string; path?: string; previewable?: boolean; kind?: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other' };
/** `length` is the requested bytes per chunk (the host clamps it); omit for the default 192 KiB. */
export type FileReader = (href: string, offset: number, length?: number) => Promise<FileChunk>;
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
export const isVideoFile = (href: string) => /\.(mp4|m4v|mov|webm)$/i.test(href);
export const isAudioFile = (href: string) => /\.(mp3|m4a|wav|ogg)$/i.test(href);
export const isHtmlFile = (href: string) => /\.html?$/i.test(href);

const decodeBase64 = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
const utf8 = (parts: string[]) => new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(parts.join('')));
type Loaded = { kind: 'media'; mime: string; url: string } | { kind: 'text'; mime: string; text: string } | { kind: 'none' };
export type FileProgress = { loaded: number; total: number };
export type GeneratedFileOptions = { length?: number; mode?: 'data' | 'blob' };
const MAX_DATA_BYTES = 25 * 1024 * 1024;
const MAX_BLOB_BYTES = 400 * 1024 * 1024;
export const VIDEO_PROBE_BYTES = 64 * 1024;
export const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const LARGE_FILE_BYTES = 150 * 1024 * 1024;
const formatBytes = (n: number) => n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Reads a referenced file through the host in bounded chunks while `active`; releases the data when inactive.
 * `mode: 'data'` (default) builds a data: URL; `mode: 'blob'` accumulates bytes into a Blob object URL (revoked on release) for large media.
 */
function useGeneratedFile(href: string, active: boolean, options: GeneratedFileOptions = {}) {
  const read = useContext(GeneratedFileContext);
  const reader = useRef(read);
  reader.current = read;
  const { length, mode = 'data' } = options;
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<FileProgress | undefined>();
  useEffect(() => {
    if (!active) { setLoaded(undefined); setPath(''); setError(''); setProgress(undefined); return; }
    let cancelled = false;
    let objectUrl = '';
    setLoaded(undefined); setError(''); setProgress(undefined);
    void (async () => {
      const read = reader.current;
      if (!read) throw new Error('Open this conversation in a connected Freddai app to preview the file.');
      const chunks: string[] = [];
      const bytes: Uint8Array[] = [];
      let offset = 0;
      let first: FileChunk | undefined;
      const limit = mode === 'blob' ? MAX_BLOB_BYTES : MAX_DATA_BYTES;
      while (!cancelled) {
        const part = length ? await read(href, offset, length) : await read(href, offset);
        first ??= part;
        if (part.size > limit) throw new Error(`File too large to preview (${Math.round(part.size / 1048576)} MB)`);
        if (part.offset !== offset || part.size !== first.size || part.mime !== first.mime) throw new Error('File changed while loading. Close and try again.');
        if (part.size === 0 && part.previewable !== false && part.kind !== 'other') throw new Error('File is empty');
        if (part.path && !cancelled) setPath(part.path);
        if (part.previewable === false || part.kind === 'other') { if (!cancelled) setLoaded({ kind: 'none' }); break; }
        let got: number;
        if (mode === 'blob') { const chunk = decodeBase64(part.data); got = chunk.length; bytes.push(chunk); }
        else { got = atob(part.data).length; chunks.push(part.data); }
        if (!got || offset + got > part.size) throw new Error('Incomplete file preview.');
        offset += got;
        if (mode === 'blob' && !cancelled) setProgress({ loaded: offset, total: part.size });
        if (offset === part.size) {
          if (cancelled) break;
          if (mode === 'blob') { objectUrl = URL.createObjectURL(new Blob(bytes as BlobPart[], { type: part.mime })); setLoaded({ kind: 'media', mime: part.mime, url: objectUrl }); }
          // Each transfer chunk is divisible by three, so base64 concatenation stays valid.
          else if (/^(text\/|application\/json$)/.test(part.mime)) setLoaded({ kind: 'text', mime: part.mime, text: utf8(chunks) });
          else setLoaded({ kind: 'media', mime: part.mime, url: `data:${part.mime};base64,${chunks.join('')}` });
          break;
        }
      }
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [active, href, length, mode]);
  return { loaded, path, error, setError, progress };
}

/** Reads only the first small chunk to learn size/mime/kind (and surface host errors) without downloading the file. */
function useFileProbe(href: string, active: boolean) {
  const read = useContext(GeneratedFileContext);
  const reader = useRef(read);
  reader.current = read;
  const [info, setInfo] = useState<{ size: number; mime: string; kind?: string; path?: string; previewable?: boolean } | undefined>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const read = reader.current;
      if (!read) throw new Error('Open this conversation in a connected Freddai app to preview the file.');
      const part = await read(href, 0, VIDEO_PROBE_BYTES);
      if (!cancelled) setInfo({ size: part.size, mime: part.mime, kind: part.kind, path: part.path, previewable: part.previewable });
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [active, href]);
  return { info, error };
}

export function PathActions({ path, href }: { path: string; href?: string }) {
  const [note, setNote] = useState('');
  const resolvePage = useContext(LocalPageContext);
  const satellite = useSatelliteMode() === true;
  const run = (action: () => Promise<unknown>, failure: string) => { setNote(''); void action().catch(e => setNote(`${failure}: ${String(e)}`)); };
  const native = isTauri();
  // On a satellite Mac the path exists only on the original Mac: open via the host's preview route, or say so loudly.
  const openOnHost = () => {
    if (!href || !resolvePage) { setNote('Could not open the file: This file is on your original Mac.'); return; }
    run(async () => {
      try { await openUrl((await resolvePage(href)).url); }
      catch (e) { throw new Error(`This file is on your original Mac and can't be opened here: ${e instanceof Error ? e.message : String(e)}`); }
    }, 'Could not open the file');
  };
  return <div className="generated-file-actions">
    <code>{path}</code>
    <button type="button" onClick={() => run(async () => { await navigator.clipboard.writeText(path); setNote('Path copied'); }, 'Could not copy the path')}>Copy path</button>
    {native && <button type="button" onClick={() => satellite ? openOnHost() : run(() => openPath(path), 'Could not open the file')}>Open in default app</button>}
    {native && !satellite && <button type="button" onClick={() => run(() => revealItemInDir(path), 'Could not reveal the file')}>Reveal in Finder</button>}
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
      {path && <PathActions path={path} href={href} />}
      {preview()}
    </DialogContent>
  </Dialog>;
}

/** True once the holder scrolls near the viewport (immediately where IntersectionObserver is unavailable). */
function useNearViewport(holder: React.RefObject<HTMLSpanElement | null>) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !holder.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible, holder]);
  return visible;
}

function Lightbox({ open, onOpenChange, src, alt, title, description, children, media }: { open: boolean; onOpenChange: (open: boolean) => void; src: string; alt: string; title: string; description: string; children?: ReactNode; media?: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="generated-lightbox" onEscapeKeyDown={e => e.stopPropagation()}>
      <DialogHeader className="sr-only"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="generated-lightbox-stage" onClick={event => { if (event.target === event.currentTarget) onOpenChange(false); }}>
        {media ?? <img src={src} alt={alt} referrerPolicy="no-referrer" />}
      </div>
      {children}
    </DialogContent>
  </Dialog>;
}

/** Inline thumbnail that loads when scrolled into view and opens a full-viewport lightbox. */
export function InlineImage({ href, alt }: { href: string; alt: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const visible = useNearViewport(holder);
  const [open, setOpen] = useState(false);
  const { loaded, path, error, setError } = useGeneratedFile(href, visible);
  const url = loaded?.kind === 'media' ? loaded.url : '';
  return <span ref={holder} className="generated-thumb">
    {error ? <span role="alert" className="generated-thumb-error">{alt || href}: {error}</span>
      : !url ? <span role="status" className="generated-thumb-loading">{loaded?.kind === 'none' ? `${alt || href} is not an image` : `Loading ${alt || 'image'}…`}</span>
      : <button type="button" className="generated-thumb-button" aria-label={`Open image: ${alt || href}`} onClick={() => setOpen(true)}>
        <img src={url} alt={alt} loading="lazy" onError={() => setError('The image could not be displayed.')} />
      </button>}
    {url && <Lightbox open={open} onOpenChange={setOpen} src={url} alt={alt} title={alt || href.split('/').pop() || 'Image'} description="Image preview from your Mac">
      {path && <PathActions path={path} href={href} />}
    </Lightbox>}
  </span>;
}

/** Hosted image (http/https) rendered like InlineImage but loaded straight from its URL; falls back to a link if it fails. */
export function RemoteImage({ src, alt }: { src: string; alt: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const visible = useNearViewport(holder);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  const label = alt || src.split('?')[0].split('/').pop() || 'image';
  const openLink = () => {
    setNote('');
    if (isTauri()) void openUrl(src).catch(e => setNote(`Could not open the link: ${String(e)}`));
    else window.open(src, '_blank', 'noopener,noreferrer');
  };
  const copyLink = () => { setNote(''); void navigator.clipboard.writeText(src).then(() => setNote('Link copied'), e => setNote(`Could not copy the link: ${String(e)}`)); };
  return <span ref={holder} className="generated-thumb">
    {failed ? <span role="alert" className="generated-thumb-error">The image could not be loaded: <a href={src} target="_blank" rel="noopener noreferrer">{src}</a></span>
      : !visible ? <span role="status" className="generated-thumb-loading">Loading {label}…</span>
      : <button type="button" className="generated-thumb-button" aria-label={`Open image: ${label}`} onClick={() => setOpen(true)}>
        <img src={src} alt={alt || label} loading="lazy" referrerPolicy="no-referrer" onError={() => { setFailed(true); setOpen(false); }} />
      </button>}
    {visible && !failed && <Lightbox open={open} onOpenChange={setOpen} src={src} alt={alt || label} title={label} description="Hosted image preview">
      <div className="generated-file-actions">
        <code>{src}</code>
        <button type="button" onClick={openLink}>Open link</button>
        <button type="button" onClick={copyLink}>Copy link</button>
        {note && <small role={note.startsWith('Link copied') ? 'status' : 'alert'}>{note}</small>}
      </div>
    </Lightbox>}
  </span>;
}

// React's media element typings omit referrerPolicy, but browsers honor it on <video>/<audio> (hosted media must not leak the app origin).
const NO_REFERRER = { referrerPolicy: 'no-referrer' } as object;
const baseName = (href: string) => { const name = href.split('?')[0].split('/').filter(Boolean).pop() ?? href; try { return decodeURIComponent(name); } catch { return name; } };
const PlayIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>;
const ExpandIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;

/** Local video/audio: a compact card that probes the first chunk, and only downloads the whole file once Play is tapped. */
export function InlineVideo({ href, alt, audio = false }: { href: string; alt: string; audio?: boolean }) {
  const holder = useRef<HTMLSpanElement>(null);
  const visible = useNearViewport(holder);
  const [play, setPlay] = useState(false);
  const [open, setOpen] = useState(false);
  const resume = useRef(0);
  const { info, error: probeError } = useFileProbe(href, visible);
  const { loaded, path, error: loadError, setError, progress } = useGeneratedFile(href, play, { length: MEDIA_CHUNK_BYTES, mode: 'blob' });
  const error = probeError || loadError;
  const name = baseName(href);
  const label = alt || name;
  const url = loaded?.kind === 'media' ? loaded.url : '';
  const unsupported = info?.previewable === false || info?.kind === 'other' || loaded?.kind === 'none';
  const large = !!info && info.size > LARGE_FILE_BYTES;
  const loading = play && !url && !error && !unsupported;
  const pct = progress && progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0;
  const mediaProps = { controls: true, preload: 'metadata' as const, src: url, onError: () => setError(`The ${audio ? 'audio' : 'video'} could not be played.`) };
  const player = (inLightbox: boolean) => audio
    ? <audio {...mediaProps} autoPlay />
    : <video {...mediaProps} playsInline autoPlay className={inLightbox ? 'generated-video generated-video-lightbox' : 'generated-video'}
      onLoadedMetadata={e => { if (inLightbox && resume.current) e.currentTarget.currentTime = resume.current; }} />;
  const expand = (event: React.MouseEvent) => {
    const el = (event.currentTarget as HTMLElement).closest('.generated-media')?.querySelector('video');
    resume.current = el?.currentTime ?? 0;
    setOpen(true);
  };
  return <span ref={holder} className="generated-thumb generated-media">
    {error ? <span role="alert" className="generated-thumb-error">{label}: {error}</span>
      : unsupported ? <span role="status" className="generated-thumb-loading">{label} cannot be previewed here</span>
      : url ? <>
        <span className="generated-media-player">
          {open && !audio ? <span className="generated-thumb-loading">Playing in expanded view</span> : player(false)}
          {!audio && !open && <button type="button" className="generated-media-expand" aria-label={`Expand video: ${label}`} onClick={expand}><ExpandIcon /></button>}
        </span>
        {!audio && <button type="button" className="generated-media-title" onClick={expand}>{label}</button>}
      </>
      : <button type="button" className="generated-media-card" disabled={loading || (!info && !play)} onClick={() => setPlay(true)} aria-label={`Play ${audio ? 'audio' : 'video'}: ${label}`}>
        <span className="generated-media-icon"><PlayIcon /></span>
        <span className="generated-media-text">
          <strong>{label}</strong>
          <small>{loading ? (progress ? `Loading ${pct}% (${formatBytes(progress.loaded)} of ${formatBytes(progress.total)})` : 'Loading…')
            : large ? `Large file (${formatBytes(info!.size)}) — may take a while over the phone connection`
            : info ? `Play · ${formatBytes(info.size)}` : 'Play'}</small>
          {loading && <progress max={100} value={pct} aria-label="Loading progress" />}
        </span>
      </button>}
    {url && !audio && <Lightbox open={open} onOpenChange={setOpen} src={url} alt={label} title={label} description="Video preview from your Mac" media={player(true)}>
      {path && <PathActions path={path} href={href} />}
    </Lightbox>}
  </span>;
}

/** Hosted video/audio played straight from its URL; falls back to a link if it fails. */
export function RemoteVideo({ src, alt, audio = false }: { src: string; alt: string; audio?: boolean }) {
  const holder = useRef<HTMLSpanElement>(null);
  const visible = useNearViewport(holder);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  const label = alt || baseName(src);
  const openLink = () => {
    setNote('');
    if (isTauri()) void openUrl(src).catch(e => setNote(`Could not open the link: ${String(e)}`));
    else window.open(src, '_blank', 'noopener,noreferrer');
  };
  const copyLink = () => { setNote(''); void navigator.clipboard.writeText(src).then(() => setNote('Link copied'), e => setNote(`Could not copy the link: ${String(e)}`)); };
  const onError = () => { setFailed(true); setOpen(false); };
  const video = (inLightbox: boolean) => <video controls playsInline preload="metadata" {...NO_REFERRER} src={src} className={inLightbox ? 'generated-video generated-video-lightbox' : 'generated-video'} onError={onError} />;
  return <span ref={holder} className="generated-thumb generated-media">
    {failed ? <span role="alert" className="generated-thumb-error">The {audio ? 'audio' : 'video'} could not be loaded: <a href={src} target="_blank" rel="noopener noreferrer">{src}</a></span>
      : !visible ? <span role="status" className="generated-thumb-loading">Loading {label}…</span>
      : audio ? <audio controls preload="metadata" {...NO_REFERRER} src={src} onError={onError} />
      : <>
        <span className="generated-media-player">
          {open ? <span className="generated-thumb-loading">Playing in expanded view</span> : video(false)}
          {!open && <button type="button" className="generated-media-expand" aria-label={`Expand video: ${label}`} onClick={() => setOpen(true)}><ExpandIcon /></button>}
        </span>
        <button type="button" className="generated-media-title" onClick={() => setOpen(true)}>{label}</button>
      </>}
    {visible && !failed && !audio && <Lightbox open={open} onOpenChange={setOpen} src={src} alt={label} title={label} description="Hosted video preview" media={video(true)}>
      <div className="generated-file-actions">
        <code>{src}</code>
        <button type="button" onClick={openLink}>Open link</button>
        <button type="button" onClick={copyLink}>Copy link</button>
        {note && <small role={note.startsWith('Link copied') ? 'status' : 'alert'}>{note}</small>}
      </div>
    </Lightbox>}
  </span>;
}
