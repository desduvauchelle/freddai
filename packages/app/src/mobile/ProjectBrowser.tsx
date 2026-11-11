import { useEffect, useState } from 'react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import type { CompanionClient, FolderListing } from './companion';

export function ProjectBrowser({ client, connected, onAdded }: { client: CompanionClient; connected: boolean; onAdded: (id: string) => Promise<void> }) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function browse(path?: string, create?: string) {
    setBusy(true); setError('');
    try { setListing(await client.projectFolders!(create === undefined ? 'browse_folders' : 'create_folder', { path, name: create })); setName(''); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (connected) void browse(); }, [client, connected]);
  const disabled = busy || !connected;
  return <div className="companion-project-browser">
    <p>Choose a folder on your Mac, or create one for your new project.</p>
    {!connected && <p role="status">Connect to your Mac to browse folders.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="flex gap-2"><Button variant="outline" disabled={disabled} onClick={() => void browse()}>Home</Button><Button variant="outline" disabled={disabled || !listing?.parent} onClick={() => void browse(listing!.parent!)}>Up</Button></div>
    <p className="companion-folder-path">{listing?.path || 'Mac home folder'}</p>
    <div className="companion-folder-list" aria-label="Mac folders" aria-busy={busy}>
      {listing?.folders.map(folder => <Button key={folder.path + folder.name} variant="ghost" disabled={disabled} onClick={() => void browse(folder.path)}>📁 {folder.name}</Button>)}
      {listing && !listing.folders.length && <p>No folders here yet.</p>}
    </div>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (!disabled && name.trim() && listing) void browse(listing.path, name.trim()); }}>
      <Input aria-label="New folder name" placeholder="New folder name" maxLength={255} value={name} disabled={disabled} onChange={e => setName(e.target.value)}/>
      <Button type="submit" disabled={disabled || !listing || !name.trim()}>Create folder</Button>
    </form>
    <Button disabled={disabled || !listing} onClick={async () => {
      setBusy(true); setError('');
      try { const result = await client.addProject!(listing!.path); await onAdded(result.id); }
      catch (e) { setError(String(e)); }
      finally { setBusy(false); }
    }}>{busy ? 'Working…' : 'Add this folder as a project'}</Button>
  </div>;
}
