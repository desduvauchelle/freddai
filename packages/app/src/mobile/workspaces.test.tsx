import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';
import { disconnectedClient, type CompanionSnapshot } from './companion';

beforeAll(() => { window.matchMedia ||= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as never; });
afterEach(() => { cleanup(); localStorage.clear(); });
const data: CompanionSnapshot = {
  projects: [{ id: 'a', name: 'Alpha', color: '#112233', canStart: false }, { id: 'b', name: 'Beta', color: '#445566', canStart: false }],
  workspaces: [{ id: 'w', name: 'Work', color: '#112233', projects: ['a'] }],
  threads: ['a', 'b'].map(id => ({ id, project: id, title: `Task ${id}`, pinned: false, status: 'done', updated: 1, messages: [], canReply: false, queued: 0, error: null })),
};
it('persists workspace scope and All workspaces clears search, project and status filters', async () => {
  const client = { ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data) };
  render(<MobileApp client={client}/>);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Workspace filter' }), { target: { value: 'w' } });
  expect(screen.queryByRole('button', { name: /Task b/ })).toBeNull();
  expect(localStorage.getItem('freddai.companion.workspace')).toBe('w');
  fireEvent.change(screen.getByRole('combobox', { name: 'Project filter' }), { target: { value: 'a' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search threads' }), { target: { value: 'nothing' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Status filter' }), { target: { value: 'running' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Workspace filter' }), { target: { value: '' } });
  // A thread appears in its project and in the bottom Recent section.
  expect(screen.getAllByRole('button', { name: /Task b/ }).length).toBeGreaterThan(0);
  expect((screen.getByRole('textbox', { name: 'Search threads' }) as HTMLInputElement).value).toBe('');
});
it('saves workspace management through the paired client', async () => {
  const saveWorkspaces = vi.fn().mockResolvedValue(undefined);
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data), saveWorkspaces }}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage workspaces' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'New workspace name' }), { target: { value: 'Personal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  await waitFor(() => expect(saveWorkspaces).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'Personal', projects: [] })])));
});
