import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';
import { disconnectedClient, type CompanionSnapshot } from './companion';

beforeAll(() => { window.matchMedia ||= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as never; });
afterEach(() => { cleanup(); localStorage.clear(); });
const data: CompanionSnapshot = {
  canReorderProjects: true,
  projects: [{ id: 'a', name: 'Alpha', color: '#112233', canStart: false }, { id: 'b', name: 'Beta', color: '#445566', canStart: false }],
  threads: [],
};
it('moves an empty project using the accessible web handle and renders the saved order', async () => {
  const moveProject = vi.fn(async () => ['b', 'a']);
  render(<MobileApp client={{ ...disconnectedClient, snapshot: async () => data, moveProject }}/>);
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Reorder Beta' }), { altKey: true, key: 'ArrowUp' });
  await waitFor(() => expect(moveProject).toHaveBeenCalledWith('b', 'a', false));
  await waitFor(() => expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['Beta threads', 'Alpha threads']));
});
it('hides web handles until the Mac advertises support', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: async () => ({ ...data, canReorderProjects: false }), moveProject: vi.fn() }}/>);
  await screen.findByRole('region', { name: 'Alpha threads' });
  expect(screen.queryByRole('button', { name: 'Reorder Alpha' })).toBeNull();
});
