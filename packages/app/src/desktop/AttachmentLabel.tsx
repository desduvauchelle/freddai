import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@freddai/ui/components/dialog";
import type { Attachment } from "./types";

/** Load retained bytes only while a user has the preview open. */
export function AttachmentLabel({ file }: { file: Attachment }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const [origin, setOrigin] = useState<CSSProperties>({});
  // The preview grows out of the thumbnail and shrinks back into it: offsets are measured from the viewport centre, where the dialog sits.
  const measure = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(1100, window.innerWidth - 48);
    setOrigin({
      "--lightbox-x": `${Math.round(rect.left + rect.width / 2 - window.innerWidth / 2)}px`,
      "--lightbox-y": `${Math.round(rect.top + rect.height / 2 - window.innerHeight / 2)}px`,
      "--lightbox-scale": String(Math.min(.9, Math.max(.05, rect.width / width))),
    } as CSSProperties);
  };
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSource(""); setError("");
    invoke<string>("preview_attachment", { id: file.id }).then(value => {
      if (!cancelled) setSource(value);
    }, reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [open, file.id]);
  const label = <><Paperclip size={12}/><span>{file.name}</span></>;
  if (!file.mime.startsWith("image/")) return label;
  return <Dialog open={open} onOpenChange={next => { measure(); setOpen(next); }}>
    <DialogTrigger asChild><button ref={trigger} type="button" className="attachment-preview-trigger" aria-label={`Preview ${file.name}`}>{label}</button></DialogTrigger>
    <DialogContent className="attachment-preview" style={origin} onEscapeKeyDown={event => event.stopPropagation()}>
      <DialogHeader><DialogTitle>{file.name}</DialogTitle><DialogDescription>Image preview · {Math.ceil(file.bytes / 1024)} KB</DialogDescription></DialogHeader>
      {error ? <p role="alert">Unable to preview this image: {error}</p> : source ? <img src={source} alt={file.name} onError={() => setError("The image could not be displayed.")}/> : <p role="status">Loading image…</p>}
    </DialogContent>
  </Dialog>;
}
