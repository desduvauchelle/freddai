import type { BackgroundTask } from '../desktop/types';

const label: Record<string, string> = { running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' };

/** One compact row per background sub-agent, outside the collapsed tool-activity group. Shared by Mac and iPhone. */
export function BackgroundTasks({ tasks }: { tasks: readonly BackgroundTask[] }) {
  if (!tasks.length) return null;
  const running = tasks.filter(t => t.status === 'running').length;
  return <section className="background-tasks" aria-label="Sub-agents">
    <h3>{running ? `${running} of ${tasks.length} sub-agent${tasks.length === 1 ? '' : 's'} running` : `${tasks.length} sub-agent${tasks.length === 1 ? '' : 's'}`}</h3>
    <ul>
      {tasks.map(t => <li key={t.id} data-status={t.status} title={t.summary || undefined}>
        <span className="background-task-dot" aria-hidden="true" />
        <span className="background-task-name">{t.description}</span>
        {t.kind && <span className="background-task-kind">{t.kind}</span>}
        <span className="background-task-status" role="status">{label[t.status] ?? t.status}</span>
      </li>)}
    </ul>
  </section>;
}
