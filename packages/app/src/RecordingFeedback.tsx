import { useLayoutEffect, useRef, useState } from 'react';
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
  const root = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const node = root.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const previous = Number(node.dataset.shift || 0);
      const left = rect.left - previous, right = rect.right - previous;
      setShift(Math.max(8 - left, Math.min(0, window.innerWidth - 8 - right)));
    };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return <span ref={root} data-shift={shift} style={{ transform: `translateX(${shift}px)` }} className="recording-feedback" role="group" aria-label="Voice recording">
    <span className="recording-capsule"><span role="timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      <span className="recording-wave" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ height: 3 + 23 * Math.min(1, (levels[i] ?? 0) * 4) }} />)}</span></span>
    <Cue axis="horizontal" progress={cancel} finger={finger} onClick={onCancel} />
    <Cue axis="vertical" progress={send} finger={finger} onClick={onSend} />
  </span>;
}
