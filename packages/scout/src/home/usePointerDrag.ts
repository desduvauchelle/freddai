import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Where a drag would land. Read from the closest `[data-drop]` element under the pointer:
 *  `data-drop` = kind, `data-drop-id` = id, `data-drop-axis` = "x" | "y" (decides `after`). */
export type DropTarget = { kind: string; id: string; after: boolean };

export type DragState<T> = { payload: T; label: string; x: number; y: number; target: DropTarget | null };

const THRESHOLD = 6;

export function dropTargetAt(x: number, y: number): DropTarget | null {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return null;
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const axis = el.dataset.dropAxis;
  const after = axis === "x" ? x > rect.left + rect.width / 2 : axis === "y" ? y > rect.top + rect.height / 2 : true;
  return { kind: el.dataset.drop ?? "", id: el.dataset.dropId ?? "", after };
}

/** Press-and-drag with pointer events (no HTML5 DnD: Tauri's native file drop handling can
 *  swallow it on some platforms). No handles: the whole element is the grip; a 6px threshold
 *  keeps plain clicks working, and the click that ends a drag is suppressed. Escape cancels. */
export function usePointerDrag<T>(onDrop: (payload: T, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback((payload: T, label: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [data-no-drag]")) return;
    cleanup.current?.();
    const origin = { x: e.clientX, y: e.clientY };
    let moved = false;
    let current: DragState<T> | null = null;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < THRESHOLD) return;
      if (!moved) document.body.classList.add("sc-dragging-body");
      moved = true;
      ev.preventDefault();
      current = { payload, label, x: ev.clientX, y: ev.clientY, target: dropTargetAt(ev.clientX, ev.clientY) };
      setDrag(current);
    };
    const end = (commit: boolean) => {
      const last = current;
      stop();
      if (!moved) return;
      // Swallow the click that follows the pointerup of a real drag.
      const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (commit && last?.target) onDropRef.current(last.payload, last.target);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); end(false); } };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      document.body.classList.remove("sc-dragging-body");
      cleanup.current = null;
      current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    cleanup.current = stop;
  }, []);

  return { drag, start };
}
