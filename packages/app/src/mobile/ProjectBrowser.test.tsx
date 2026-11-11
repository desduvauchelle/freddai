import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProjectBrowser } from './ProjectBrowser';
import type { CompanionClient } from './companion';
it('browses the Mac, creates a folder, then adds that folder without starting a thread', async () => {
  const projectFolders = vi.fn().mockResolvedValueOnce({ path: '/Users/test', parent: null, folders: [{ name: 'Documents', path: '/Users/test/Documents' }] }).mockResolvedValueOnce({ path: '/Users/test/Documents', parent: '/Users/test', folders: [] }).mockResolvedValueOnce({ path: '/Users/test/Documents/new', parent: '/Users/test/Documents', folders: [] });
  const addProject = vi.fn().mockResolvedValue({ id: 'new' });
  const onAdded = vi.fn().mockResolvedValue(undefined);
  render(<ProjectBrowser connected client={{ projectFolders, addProject } as unknown as CompanionClient} onAdded={onAdded}/>);
  fireEvent.click(await screen.findByText('📁 Documents'));
  await screen.findByText('/Users/test/Documents');
  fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'new' } });
  fireEvent.click(screen.getByText('Create folder'));
  await screen.findByText('/Users/test/Documents/new');
  expect(projectFolders).toHaveBeenLastCalledWith('create_folder', { path: '/Users/test/Documents', name: 'new' });
  fireEvent.click(screen.getByText('Add this folder as a project'));
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith('new'));
  expect(addProject).toHaveBeenCalledWith('/Users/test/Documents/new');
});
