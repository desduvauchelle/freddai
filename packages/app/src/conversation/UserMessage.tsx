import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import { stripVoiceCall } from './voiceCallMarkup';

/** Compact plain-text preview; expanding restores the complete formatted message. */
export function UserMessage({ text: raw }: { text: string }) {
  const { text, voice } = stripVoiceCall(raw);
  const id = useId();
  const preview = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const node = preview.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  return <div className="user-message-text">
    {voice && <span className="user-message-voice" role="img" aria-label="Sent by voice" title="Sent by voice"><Mic size={11} aria-hidden="true" /></span>}
    <div ref={preview} className="user-message-preview" aria-hidden={expanded || undefined} hidden={expanded}>{text}</div>
    <div id={id}>{expanded && <MessageMarkdown text={text} />}</div>
    {(overflow || expanded) && <button type="button" className="user-message-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</button>}
  </div>;
}
