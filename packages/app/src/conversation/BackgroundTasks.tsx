import type { BackgroundTask } from '../desktop/types';

const label: Record<string, string> = { running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' };

const isCommand = (t: BackgroundTask) => t.kind === 'bash' || t.kind === 'monitor';

/** One compact row per background sub-agent or background command, outside the collapsed tool-activity group. Shared by Mac and iPhone. */
export function BackgroundTasks({ tasks }: { tasks: readonly BackgroundTask[] }) {
  if (!tasks.length) return null;
  const agents = tasks.filter(t => !isCommand(t));
  const running = agents.filter(t => t.status === 'running').length;
  const heading = !agents.length ? 'Background commands'
    : running ? `${running} of ${agents.length} sub-agent${agents.length === 1 ? '' : 's'} running`
    : `${agents.length} sub-agent${agents.length === 1 ? '' : 's'}`;
  return <section className="background-tasks" aria-label={agents.length ? 'Sub-agents' : 'Background commands'}>
    <h3>{heading}</h3>
    <ul>
      {tasks.map(t => <li key={t.id} data-status={t.status} title={t.summary || undefined}>
        <span className="background-task-dot" aria-hidden="true" />
        <span className="background-task-name">{isCommand(t) && t.status === 'running' ? `Waiting on background command: ${t.description}` : t.description}</span>
        {t.kind && !isCommand(t) && <span className="background-task-kind">{t.kind}</span>}
        <span className="background-task-status" role="status">{label[t.status] ?? t.status}</span>
      </li>)}
    </ul>
  </section>;
}
