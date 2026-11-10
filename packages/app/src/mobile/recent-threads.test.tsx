import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';
import { disconnectedClient, type CompanionSnapshot } from './companion';

beforeAll(() => { window.matchMedia ||= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as never; });
afterEach(() => { cleanup(); localStorage.clear(); });
const data = (count: number): CompanionSnapshot => ({
  projects: [{ id: 'a', name: 'Alpha', color: '#112233', canStart: false }, { id: 'b', name: 'Beta', color: '#445566', canStart: false }],
  threads: Array.from({ length: count }, (_, i) => ({ id: `t${i}`, project: i % 2 ? 'a' : 'b', title: `Task ${String(i).padStart(2, '0')}`, status: 'done', updated: 100 + i, messages: [], canReply: false, queued: 0, error: null })),
});
const view = (name: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Thread view' }), { target: { value: name.toLowerCase() } });
const rows = () => screen.queryAllByRole('button', { name: /^Task \d\d/ });

const section = () => screen.getByRole('region', { name: 'Recent threads' });
const sectionRows = () => within(section()).queryAllByRole('button', { name: /^Task \d\d/ });

it('Recent view lists the newest threads across projects, 25 first, +25 per Show more, back to 25, and persists the choice', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(70)) }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  view('Recent');
  expect(rows()).toHaveLength(25);
  expect(rows()[0].querySelector('strong')!.textContent).toBe('Task 69');
  expect(within(rows()[0]).getByText('Alpha')).toBeTruthy();
  expect(localStorage.getItem('freddai.companion.threadNavView')).toBe('recent');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(rows()).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(rows()).toHaveLength(70);
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(rows()).toHaveLength(25);
});

it('Projects view ends with an always-visible Recent section: 5 rows with project tags, +10 then Show less, hidden without threads', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(30)) }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  expect(sectionRows().map(r => r.querySelector('strong')!.textContent)).toEqual(['Task 29', 'Task 28', 'Task 27', 'Task 26', 'Task 25']);
  expect(within(sectionRows()[0]).getByText('Alpha')).toBeTruthy();
  expect(screen.getAllByRole('heading', { name: 'Recent' })).toHaveLength(1);
  fireEvent.click(within(section()).getByRole('button', { name: 'Show more' }));
  expect(sectionRows()).toHaveLength(15);
  fireEvent.click(within(section()).getByRole('button', { name: 'Show more' }));
  expect(sectionRows()).toHaveLength(25);
  fireEvent.click(within(section()).getByRole('button', { name: 'Show less' }));
  expect(sectionRows()).toHaveLength(5);
  cleanup();
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(0)) }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  expect(screen.queryByRole('region', { name: 'Recent threads' })).toBeNull();
});

it('restores the saved view and shows an empty state', async () => {
  localStorage.setItem('freddai.companion.threadNavView', 'recent');
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(0)) }}/>);
  expect(await screen.findByText('No recent threads')).toBeTruthy();
  view('Projects');
  expect(screen.queryByText('No recent threads')).toBeNull();
});

it('Recent paging resets to the first page when search or filters change', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(60)) }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  view('Recent');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(rows()).toHaveLength(50);
  fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'Task' } });
  expect(rows()).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: '' } });
  expect(rows()).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: 'a' } });
  expect(rows()).toHaveLength(25);
  // The Projects-view section resets too.
  view('Projects');
  fireEvent.click(within(section()).getByRole('button', { name: 'Show more' }));
  expect(sectionRows()).toHaveLength(15);
  fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: '' } });
  expect(sectionRows()).toHaveLength(5);
});


it('closes a browser thread sheet by dragging its handle down to Dashboard', async () => {
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(data(2)) }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  fireEvent.click(rows()[0]);
  expect(screen.queryByRole('button', { name: 'Close thread' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to threads' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  fireEvent.click(document.querySelector<HTMLButtonElement>('.companion-project-recent')!);
  const handle = await screen.findByRole('button', { name: 'Close thread' });
  fireEvent.touchStart(handle, { touches: [{ clientX: 150, clientY: 20 }] });
  fireEvent.touchMove(handle, { touches: [{ clientX: 152, clientY: 110 }] });
  fireEvent.touchEnd(handle, { touches: [], changedTouches: [{ clientX: 152, clientY: 110 }] });
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close thread' })).toBeNull();
});
