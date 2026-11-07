import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MessageMarkdown } from './MessageMarkdown';

/** Compact plain-text preview; expanding restores the complete formatted message. */
export function UserMessage({ text }: { text: string }) {
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
    <div ref={preview} className="user-message-preview" aria-hidden={expanded || undefined} hidden={expanded}>{text}</div>
    <div id={id}>{expanded && <MessageMarkdown text={text} />}</div>
    {(overflow || expanded) && <button type="button" className="user-message-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</button>}
  </div>;
}
