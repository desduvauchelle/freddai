import { GripVertical } from 'lucide-react';
import { useRef } from 'react';

/** A dedicated handle leaves project taps and list scrolling available elsewhere. */
export function ProjectReorderHandle({ id, name, order, onMove }: { id: string; name: string; order: string[]; onMove(id: string, target: string, after: boolean): void }) {
  const drag = useRef<{ pointer: number; target: string; after: boolean } | null>(null);
  return <button className="companion-project-drag" aria-label={`Reorder ${name}`} title="Drag to reorder · Alt+↑/↓ to move"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, target: id, after: false };
    }}
    onPointerMove={event => {
      if (drag.current?.pointer !== event.pointerId) return;
      const heading = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-project-reorder]');
      if (heading?.dataset.projectReorder) drag.current = { pointer: event.pointerId, target: heading.dataset.projectReorder, after: event.clientY > heading.getBoundingClientRect().top + heading.getBoundingClientRect().height / 2 };
    }}
    onPointerUp={event => {
      const drop = drag.current; drag.current = null;
      if (drop?.pointer === event.pointerId && drop.target !== id) onMove(id, drop.target, drop.after);
    }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const offset = event.key === 'ArrowDown' ? 1 : -1, target = order[order.indexOf(id) + offset];
      if (target) { event.preventDefault(); onMove(id, target, offset > 0); }
    }}><GripVertical size={16}/></button>;
}
