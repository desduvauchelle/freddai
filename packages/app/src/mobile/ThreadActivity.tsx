import { ActivityControls } from '../conversation/ActivityControls';
import { Dormouse } from '../desktop/Dormouse';
import type { CompanionThread } from './companion';
import type { ConnectionState } from './connection-status';

/** Transport state wins: a cached running snapshot must not look live while disconnected. */
export function companionActivity(thread: Pick<CompanionThread, 'status' | 'pending' | 'queuePaused'> | undefined, connection: ConnectionState) {
  if (connection !== 'ok') return { mood: 0, label: connection === 'down' ? 'Mac disconnected · Status unavailable' : 'Connecting to Mac…', state: 'offline' };
  if (!thread) return { mood: 0, label: 'Loading thread…', state: 'loading' };
  if (thread.status === 'failed') return { mood: 8, label: 'Failed · Needs attention', state: 'failed' };
  if (thread.status === 'interrupted') return { mood: 7, label: 'Interrupted', state: 'interrupted' };
  if (thread.pending || thread.status === 'waiting') return { mood: 4, label: 'Waiting for you', state: 'waiting' };
  if (thread.status === 'starting') return { mood: 2, label: 'Starting…', state: 'starting' };
  if (thread.status === 'running') return { mood: 2, label: 'Working…', state: 'running' };
  if (thread.queuePaused) return { mood: 7, label: 'Message queue paused', state: 'paused' };
  if (thread.status === 'done') return { mood: 6, label: 'Completed', state: 'done' };
  return { mood: 0, label: 'Ready', state: 'idle' };
}

/** Final transcript item; scrolls with messages in native and web companions. */
export function ThreadActivity({ thread, connection, onStop, onResume, disabled }: { thread: CompanionThread | undefined; connection: ConnectionState; onStop?: () => void; onResume?: () => void; disabled?: boolean }) {
  const activity = companionActivity(thread, connection);
  const controls = <ActivityControls active={['starting', 'running', 'waiting'].includes(activity.state)} interrupted={activity.state === 'interrupted'} onStop={onStop} onResume={onResume} disabled={disabled} />;
  return <div className="companion-activity" data-state={activity.state}>
    <Dormouse size={44} priority={4} mood={activity.mood} label={activity.label} />
    {activity.state === 'interrupted' && controls}
    <span role="status" aria-live="polite" aria-atomic="true">{activity.label}</span>
    {activity.state !== 'interrupted' && controls}
  </div>;
}
