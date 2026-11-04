import { useEffect, useRef, useState } from "react";
import type { Message } from "../desktop/types";

/** Collapsed-by-default thinking block. Streams live while `live`; afterwards shows how long it was observed thinking. */
export function ReasoningBlock({ message, live, className }: { message: Message; live: boolean; className?: string }) {
  const started = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (live) { started.current ??= Date.now(); return; }
    if (started.current !== null) { setSeconds(Math.max(1, Math.round((Date.now() - started.current) / 1000))); started.current = null; }
  }, [live]);
  const label = live ? "Thinking…" : seconds !== null ? `Thought for ${seconds}s` : "Thought";
  return <details className={className ? `reasoning-block ${className}` : "reasoning-block"} data-role="reasoning" data-live={live}>
    <summary>{label}</summary>
    <div className="reasoning-text">{message.text}</div>
  </details>;
}
