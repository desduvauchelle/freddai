import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
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
  fireEvent.click(document.querySelector<HTMLButtonElement>('.home-recent button')!);
  const handle = await screen.findByRole('button', { name: 'Close thread' });
  fireEvent.touchStart(handle, { touches: [{ clientX: 150, clientY: 20 }] });
  fireEvent.touchMove(handle, { touches: [{ clientX: 152, clientY: 110 }] });
  fireEvent.touchEnd(handle, { touches: [], changedTouches: [{ clientX: 152, clientY: 110 }] });
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close thread' })).toBeNull();
});

it('keeps the satellite navigator beside the dashboard and selected conversation, and can hide and reopen it', async () => {
  const snapshot = data(2);
  snapshot.threads[0].messages = [{ role: 'assistant', text: 'Remote conversation content' } as never];
  render(<MobileApp desktop client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(snapshot) }} deviceSettings={<p>This Mac settings</p>} />);
  expect(await screen.findByRole('button', { name: 'Dashboard' })).toBeTruthy();
  const sidebar = screen.getByRole('complementary', { name: 'Thread navigator' });
  const thread = await within(sidebar).findAllByRole('button', { name: /^Task 00/ });
  fireEvent.click(thread[0]);
  expect(await screen.findByText('Remote conversation content')).toBeTruthy();
  expect(screen.getByRole('complementary', { name: 'Thread navigator' })).toBe(sidebar);
  fireEvent.click(screen.getAllByRole('button', { name: 'Toggle thread navigator' })[0]);
  expect(screen.queryByRole('complementary', { name: 'Thread navigator' })).toBeNull();
  expect(screen.getByText('Remote conversation content')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Toggle thread navigator' })[0]);
  expect(screen.getByRole('complementary', { name: 'Thread navigator' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  expect(await screen.findByText('This Mac settings')).toBeTruthy();
});

it('per-project older threads: "Show more (N)" pages by ten, "Show less" appears only once expanded, resets to the default, and stays when nothing remains', async () => {
  // 30 done threads in Alpha: 5 stay visible, 25 sit under "Show older threads".
  const alpha: CompanionSnapshot = { ...data(0), threadList: { ignoreUnread: true }, threads: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, project: 'a', title: `Task ${String(i).padStart(2, '0')}`, status: 'done', updated: 100 + i, messages: [], canReply: false, queued: 0, error: null })) };
  render(<MobileApp client={{ ...disconnectedClient, snapshot: vi.fn().mockResolvedValue(alpha) }}/>);
  const region = await screen.findByRole('region', { name: 'Alpha threads' });
  const alphaRows = () => within(region).queryAllByRole('button', { name: /^Task \d\d/ });
  expect(alphaRows()).toHaveLength(5);
  expect(within(region).queryByRole('button', { name: 'Show less' })).toBeNull();
  fireEvent.click(within(region).getByRole('button', { name: 'Show older threads (25)' }));
  expect(alphaRows()).toHaveLength(15);
  expect(within(region).getByRole('button', { name: 'Show more (15)' })).toBeTruthy();
  expect(within(region).getByRole('button', { name: 'Show less' })).toBeTruthy();
  fireEvent.click(within(region).getByRole('button', { name: 'Show more (15)' }));
  fireEvent.click(within(region).getByRole('button', { name: 'Show more (5)' }));
  expect(alphaRows()).toHaveLength(30);
  expect(within(region).queryByRole('button', { name: /^Show more/ })).toBeNull();
  fireEvent.click(within(region).getByRole('button', { name: 'Show less' }));
  expect(alphaRows()).toHaveLength(5);
  expect(within(region).queryByRole('button', { name: 'Show less' })).toBeNull();
  expect(within(region).getByRole('button', { name: 'Show older threads (25)' })).toBeTruthy();
});


it('deleting a browser dashboard thread closes its sheet and restores Dashboard', async () => {
  const snapshot = data(2);
  const action = vi.fn(async () => { snapshot.threads = []; });
  render(<MobileApp client={{ ...disconnectedClient, snapshot: async () => structuredClone(snapshot), action }}/>);
  await screen.findByRole('combobox', { name: 'Thread view' });
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  fireEvent.click(document.querySelector<HTMLButtonElement>('.home-recent button')!);
  await screen.findByRole('button', { name: 'Close thread' });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Thread actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Move to Deleted' }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close thread' })).toBeNull();
});
