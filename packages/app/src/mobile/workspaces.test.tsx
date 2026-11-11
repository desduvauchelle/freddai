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

it('dashboard ignores the sidebar workspace, project and status filters', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data) }}/>);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Workspace filter' }), { target: { value: 'w' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Project filter' }), { target: { value: 'a' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Status filter' }), { target: { value: 'running' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  expect(screen.queryByRole('combobox', { name: 'Workspace filter' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy();
});

it('shows one removable chip per active filter and clears only that filter', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data) }}/>);
  await screen.findByRole('combobox', { name: 'Workspace filter' });
  expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Workspace filter' }), { target: { value: 'w' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Project filter' }), { target: { value: 'a' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Status filter' }), { target: { value: 'done' } });
  expect(screen.getAllByRole('listitem').map(li => li.getAttribute('data-kind'))).toEqual(['workspace', 'project', 'status']);
  fireEvent.click(screen.getByRole('button', { name: 'Remove status filter Finished' }));
  expect((screen.getByRole('combobox', { name: 'Status filter' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('combobox', { name: 'Project filter' }) as HTMLSelectElement).value).toBe('a');
  fireEvent.click(screen.getByRole('button', { name: 'Remove project filter Alpha' }));
  expect((screen.getByRole('combobox', { name: 'Project filter' }) as HTMLSelectElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: 'Workspace filter' }) as HTMLSelectElement).value).toBe('w');
  fireEvent.click(screen.getByRole('button', { name: 'Remove workspace filter Work' }));
  expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
});

it('keeps the Commander tile visible under filters and opens Commander', async () => {
  const withCommander = { ...data, projects: [{ id: 'cmd', name: 'Commander', color: '#fff', canStart: true, kind: 'commander' as const }, ...data.projects] };
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(withCommander) }}/>);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Project filter' }), { target: { value: 'a' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search threads' }), { target: { value: 'nothing' } });
  expect(screen.getByRole('button', { name: 'Commander' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
});

it('edits project presentation and saved order from organization settings', async () => {
  const updateProjectOrganization = vi.fn().mockResolvedValue(undefined);
  const moveProject = vi.fn().mockResolvedValue(['b', 'a']);
  const snapshot = { ...data, canReorderProjects: true, threadList: { projectOrder: ['b', 'a'] } };
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(snapshot), updateProjectOrganization, moveProject }}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  const name = await screen.findByRole('textbox', { name: 'Project name for Alpha' });
  fireEvent.change(name, { target: { value: 'Renamed' } });
  const form = screen.getByRole('form', { name: 'Edit Alpha' });
  fireEvent.submit(form);
  await waitFor(() => expect(updateProjectOrganization).toHaveBeenCalledWith('a', 'Renamed', '#112233'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move Alpha up' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Move Alpha up' }));
  await waitFor(() => expect(moveProject).toHaveBeenCalledWith('a', 'b', false));
});

it('shows the call button on a new web companion thread before any message exists', async () => {
  const snapshot = { ...data, projects: [{ ...data.projects[0], canStart: true }] };
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(snapshot), transcribeAudio: vi.fn() }}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'New thread' }));
  const call = await screen.findByRole('button', { name: 'Start call' });
  expect(call.hasAttribute('disabled')).toBe(false);
});
