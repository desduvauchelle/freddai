import { Button } from '@freddai/ui/components/button';
import type { ThreadNavView } from './recentThreads';

const VIEWS: { id: ThreadNavView; label: string }[] = [{ id: 'projects', label: 'Projects' }, { id: 'recent', label: 'Recent' }];

/** Segmented Projects | Recent switch shared by the desktop sidebar and the companion thread list. */
export function ThreadViewToggle({ value, onChange }: { value: ThreadNavView; onChange: (view: ThreadNavView) => void }) {
  return <div className="thread-view-toggle" role="group" aria-label="Thread view">
    {VIEWS.map(view => <button key={view.id} type="button" aria-label={`${view.label} view`} aria-pressed={value === view.id} onClick={() => onChange(view.id)}>{view.label}</button>)}
  </div>;
}

/** "Show more" reveals RECENT_STEP more rows; "Show less" collapses back to the first page. */
export function RecentThreadsFooter({ remaining, expanded, onMore, onLess, className }: {
  remaining: number; expanded: boolean; onMore: () => void; onLess: () => void; className?: string;
}) {
  if (remaining <= 0 && !expanded) return null;
  return <div className="recent-threads-footer">
    {remaining > 0 && <Button className={className} variant="ghost" size="sm" onClick={onMore}>Show more</Button>}
    {expanded && <Button className={className} variant="ghost" size="sm" aria-expanded onClick={onLess}>Show less</Button>}
  </div>;
}
