import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@freddai/ui/components/dialog';
import type { ReactNode } from 'react';

export type FileChunk = { mime: string; size: number; offset: number; data: string };
export type FileReader = (href: string, offset: number) => Promise<FileChunk>;
export const GeneratedFileContext = createContext<FileReader | undefined>(undefined);
export function isGeneratedFile(href: string) {
  return !/^(https?:|javascript:|data:|blob:)/i.test(href) && /\.(png|jpe?g|gif|webp|pdf)$/i.test(href) && !/^[a-z]+:/i.test(href.replace(/^(file:\/\/|sandbox:)/i, ''));
}
export function GeneratedFile({ href, children }: { href: string; children: ReactNode }) {
  const read = useContext(GeneratedFileContext);
  const reader = useRef(read);
  reader.current = read;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [mime, setMime] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) { setSource(''); setMime(''); setError(''); return; }
    let cancelled = false;
    setSource(''); setError('');
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
        const data = atob(part.data);
        if (!data.length || offset + data.length > part.size) throw new Error('Incomplete file preview.');
        chunks.push(part.data); offset += data.length;
        if (offset === part.size) {
          // Each transfer chunk is divisible by three, so base64 concatenation stays valid.
          if (!cancelled) { setMime(part.mime); setSource(`data:${part.mime};base64,${chunks.join('')}`); }
          break;
        }
      }
    })().catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [open, href]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="generated-file-link">{children}</button></DialogTrigger>
    <DialogContent style={{ width: 'min(1100px, 94vw)', maxWidth: '94vw', maxHeight: '90dvh', overflow: 'auto' }} onEscapeKeyDown={e => e.stopPropagation()}>
      <DialogHeader><DialogTitle>{href.split('/').pop() || 'Generated file'}</DialogTitle><DialogDescription>File preview from your Mac</DialogDescription></DialogHeader>
      {error ? <p role="alert">{error}</p> : !source ? <p role="status">Loading preview…</p> : mime === 'application/pdf' ? <iframe title="PDF preview" src={source} style={{ width: '100%', height: '65dvh', border: 0 }} /> : <img src={source} alt={typeof children === 'string' ? children : 'Generated image'} style={{ width: '100%', maxHeight: '70dvh', objectFit: 'contain' }} onError={() => setError('The image could not be displayed.')} />}
    </DialogContent>
  </Dialog>;
}
