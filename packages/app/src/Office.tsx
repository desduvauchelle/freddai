import type { Thread } from './model';
export function Pixel({ color = 'green' }: { color?: string }) { return <span aria-hidden="true" className={`pixel ${color}`}><i/><b/><em/></span>; }
export function Office({ threads, onSelect, compact = false }: { threads: Thread[]; onSelect: (id: string) => void; compact?: boolean }) {
  const visible = threads.filter(t => t.status !== 'Done' && t.agent !== 'Unassigned');
  return <div className={`office ${compact ? 'compact' : ''}`}>
    <div className="office-wall"><span>F R E D D A I &nbsp; S T U D I O</span><div className="window-pixel"/><div className="clock-pixel">◷</div></div>
    <div className="office-floor">{visible.map((t,i) => <button key={t.id} className={`station ${t.status === 'In progress' ? 'working' : ''}`} onClick={() => onSelect(t.id)} title={`${t.agent} · ${t.title} · ${t.schedule || t.status}`} aria-label={`${t.agent}: ${t.title}, ${t.schedule || t.status}`}>
      <span className="station-cue">{t.schedule ? '◷' : t.status === 'Needs you' ? '?' : t.status === 'Review' ? '✓' : '···'}</span>
      <Pixel color={['green','orange','blue'][i%3]}/><span className={t.schedule ? 'clock-shrine' : 'desk'}>{t.schedule ? '◷' : <i/>}</span>
      <span className="agent-label">{t.agent}<small>{t.schedule ? 'Scheduled' : t.status}</small></span>
    </button>)}</div><div className="office-caption">{compact ? 'A little window into your work' : 'Select an agent to open their thread · Illustrative activity'}</div>
  </div>;
}
