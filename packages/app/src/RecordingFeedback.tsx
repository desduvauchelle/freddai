import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, X } from 'lucide-react';
import { recordingCueOffset } from './recording-gesture';
import './recording-feedback.css';

function Cue({ axis, progress, finger, onClick }: { axis: 'horizontal' | 'vertical'; progress: number; finger: { x: number; y: number } | null; onClick: () => void }) {
  const rail = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const rect = rail.current?.getBoundingClientRect();
    if (rect) setOffset(recordingCueOffset({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, finger, progress, axis));
  }, [axis, finger, progress]);
  const cancel = axis === 'horizontal';
  return <span ref={rail} className={`recording-rail recording-rail-${axis}`}><button type="button"
    aria-label={cancel ? 'Cancel recording' : 'Send recording'} onClick={onClick}
    data-progress={progress} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${1 + progress * (cancel ? 0.5 : 1)})` }}>
    {cancel ? <X size={18} /> : <ArrowUp size={19} />}
  </button></span>;
}

/** Shared dashboard/composer feedback for desktop and browser companions. Native shells mirror these rails. */
export function RecordingFeedback({ elapsed, levels = [], send, cancel, finger, onCancel, onSend }: {
  elapsed: number; levels?: number[]; send: number; cancel: number; finger: { x: number; y: number } | null; onCancel: () => void; onSend: () => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const fit = () => {
      const rect = anchor.current?.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const above = rect.top - 116;
      setPosition({
        left: Math.max(left + 8, Math.min(rect.right - 268, left + width - 276)),
        top: Math.max(top + 8, Math.min(above >= top + 8 ? above : rect.bottom + 8, top + height - 116)),
      });
    };
    fit(); window.addEventListener('resize', fit); window.addEventListener('scroll', fit, true);
    window.visualViewport?.addEventListener('resize', fit); window.visualViewport?.addEventListener('scroll', fit);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (anchor.current?.parentElement) observer?.observe(anchor.current.parentElement);
    return () => {
      window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true);
      window.visualViewport?.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('scroll', fit);
      observer?.disconnect();
    };
  }, []);
  return <><span ref={anchor} aria-hidden="true" />{createPortal(<span style={position} className="recording-feedback" role="group" aria-label="Voice recording">
    <span className="recording-capsule"><span role="timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      <span className="recording-wave" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ height: 3 + 23 * Math.min(1, (levels[i] ?? 0) * 4) }} />)}</span></span>
    <Cue axis="horizontal" progress={cancel} finger={finger} onClick={onCancel} />
    <Cue axis="vertical" progress={send} finger={finger} onClick={onSend} />
  </span>, document.body)}</>;
}
