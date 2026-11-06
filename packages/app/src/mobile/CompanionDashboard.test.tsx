import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanionDashboard } from './CompanionDashboard';
import { disconnectedClient, type CompanionSnapshot } from './companion';
afterEach(cleanup);
it('counts activity across projects, retains empty projects and opens pending decisions', () => {
  const now = new Date(2026, 10, 4, 12).getTime(), onOpen = vi.fn(), onNew = vi.fn();
  const base = { project: 'p', updated: now, messages: [], canReply: true, queued: 0, error: null };
  const snapshot: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }, { id: 'empty', name: 'Empty', color: '#777', canStart: false }], threads: [
    { ...base, id: 'running', title: 'Working', status: 'starting' },
    { ...base, id: 'pending', title: 'Approval', status: 'running', pending: { id: 'approval' } as never },
    { ...base, id: 'done', title: 'Finished', status: 'done' },
    { ...base, id: 'old', title: 'Yesterday', status: 'done', updated: now - 86400000 },
    { ...base, id: 'failed', title: 'Failed', status: 'failed' },
  ] };
  render(<CompanionDashboard snapshot={snapshot} connected onOpen={onOpen} onNew={onNew} now={now} />);
  expect(screen.getByText('1 working · 1 need you · 1 done today · 1 failed today')).toBeTruthy();
  expect(screen.getByRole('article', { name: 'Project Empty' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open project Empty' }));
  expect((screen.getByRole('button', { name: 'New thread in Empty' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: /Approval.*Review decision/ }));
  expect(onOpen).toHaveBeenCalledWith('pending');
  fireEvent.click(screen.getByRole('button', { name: 'Open project Project' }));
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenCalledWith('p', undefined);
});
it('offers one global coding agent and passes the choice to new threads', () => {
  const onNew = vi.fn();
  render(<CompanionDashboard connected onNew={onNew} onOpen={vi.fn()} snapshot={{ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }] }], threads: [] }} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Coding agent' }), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open project Project' }));
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenCalledWith('p', 'b');
});
it('applies the global agent across projects and keeps thread navigation in the project panel', () => {
  const onNew = vi.fn(), onOpen = vi.fn();
  const assistants = [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }];
  render(<CompanionDashboard connected onNew={onNew} onOpen={onOpen} snapshot={{
    projects: ['One', 'Two'].map(name => ({ id: name, name, color: '#777', canStart: true, defaultAssistant: 'a', assistants })),
    threads: [{ id: 't', project: 'Two', title: 'Existing task', updated: 1, status: 'done', messages: [], canReply: true, queued: 0, error: null }],
  }} />);
  expect(screen.queryByText('Open latest thread')).toBeNull();
  expect(screen.getAllByRole('combobox', { name: 'Coding agent' })).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Coding agent' }), { target: { value: 'b' } });
  for (const name of ['One', 'Two']) {
    fireEvent.click(screen.getByRole('button', { name: `Open project ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: `New thread in ${name}` }));
    expect(onNew).toHaveBeenLastCalledWith(name, 'b');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Open project Two' }));
  fireEvent.click(screen.getByRole('button', { name: 'Existing task' }));
  expect(onOpen).toHaveBeenCalledWith('t');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('exposes launch and microphone controls directly on cards and honors global fallback and readiness', () => {
  const onNew = vi.fn();
  const snapshot: CompanionSnapshot = { projects: [
    { id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }] },
    { id: 'fallback', name: 'Fallback', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }] },
    { id: 'blocked', name: 'Blocked', color: '#777', canStart: false },
  ], threads: [] };
  const props = { snapshot, onNew, onOpen: vi.fn(), onDictation: vi.fn(), client: { ...disconnectedClient, transcribeAudio: vi.fn() } };
  const { rerender } = render(<CompanionDashboard {...props} connected />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('button', { name: 'Dictate task in Project' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole('combobox', { name: 'Coding agent' }), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenLastCalledWith('p', 'b');
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Fallback' }));
  expect(onNew).toHaveBeenLastCalledWith('fallback', 'a');
  expect((screen.getByRole('button', { name: 'New thread in Blocked' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<CompanionDashboard {...props} connected={false} />);
  for (const name of ['New thread in Project', 'Dictate task in Project']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
});

it('leaves only Office in the web surface when native dashboard content is supported', () => {
  const get = vi.fn();
  render(<CompanionDashboard nativeCards nativeContent connected snapshot={{ projects: [], threads: [] }} onOpen={vi.fn()} onNew={vi.fn()}
    client={{ ...disconnectedClient, summaries: { get, generate: vi.fn() } }} />);
  expect(screen.queryByText('Your projects')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Daily summaries' })).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
