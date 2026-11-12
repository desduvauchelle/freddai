import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@freddai/ui/components/button';
export type ProjectEditorClient = { available(): Promise<boolean>; open(project: string): Promise<unknown> };
export const desktopProjectEditor: ProjectEditorClient = {
  available: () => invoke<boolean>('vscode_available'),
  open: project => invoke('open_project_vscode', { project }),
};
export function useProjectEditor(client?: ProjectEditorClient) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    setAvailable(false);
    const check = () => { void client?.available().then(value => { if (active) setAvailable(value); }).catch(() => { if (active) setAvailable(false); }); };
    check(); window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('focus', check); };
  }, [client]);
  return available;
}
export function OpenProjectEditor({ client, project, remote = false, disabled = false }: { client?: ProjectEditorClient; project: string; remote?: boolean; disabled?: boolean }) {
  const available = useProjectEditor(client);
  return available ? <ProjectEditorButton client={client} project={project} remote={remote} disabled={disabled} /> : null;
}
export function ProjectEditorButton({ client, project, remote = false, disabled = false }: { client?: ProjectEditorClient; project: string; remote?: boolean; disabled?: boolean }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  if (!client || !project) return null;
  return <div><Button type="button" variant="outline" disabled={disabled || opening} onClick={async () => {
    setOpening(true); setError('');
    try { await client!.open(project); } catch (e) { setError(String(e)); } finally { setOpening(false); }
  }}>{remote ? 'Open in VS Code on Mac' : 'Open in VS Code'}</Button>{error && <p role="alert">{error}</p>}</div>;
}
