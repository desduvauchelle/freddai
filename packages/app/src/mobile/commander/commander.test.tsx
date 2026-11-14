import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Proposal, Todo } from '../../desktop/commander/api';
import { CompanionDashboard } from '../CompanionDashboard';
import { disconnectedClient, type CompanionClient, type CommanderClient } from '../companion';
import { createFixtureClient } from '../fixture-client';
import { MobileApp } from '../MobileApp';
import { ApprovalCard, CommanderPanel, CommanderSheet, groupMobileTodos } from './CommanderChrome';
import type { CommanderData } from './useCommanderData';

vi.mock('../../desktop/Dormouse', () => ({ Dormouse: ({ label }: { label: string }) => <span data-testid="mascot">{label}</span> }));
beforeAll(() => { window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never; });
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const proposal = (extra: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', tool: 'freddai_start_task', summary: 'Start a task in Lucy Web', project: 'lucy', arguments: { prompt: 'Add a pricing FAQ.' },
  status: 'pending', result: null, error: null, thread: null, created_at: '2026-11-07T10:00:00Z', decided_at: null, ...extra,
});
const todo = (id: string, project: string | null, extra: Partial<Todo> = {}): Todo => ({
  id, title: `Todo ${id}`, description: null, project, owner: 'me', thread: null, status: 'open', due: null, check_back_at: null, verification: [],
  completion_basis: null, completion_note: null, created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z', history: [], ...extra,
});
const projects = [{ id: 'lucy', name: 'Lucy Web', color: '#2fa37a', canStart: true }, { id: 'freddai', name: 'Freddai', color: '#7c6cf0', canStart: true }];

it('renders the Commander cluster above the projects and opens the screen from the avatar and the pill', async () => {
  const onOpen = vi.fn();
  const client = createFixtureClient();
  const snapshot = await client.snapshot(new AbortController().signal);
  render(<CompanionDashboard client={client} snapshot={snapshot} connected onOpen={vi.fn()} onNew={vi.fn()} onOpenCommander={onOpen} onSendCommander={vi.fn()} />);
  const cluster = await screen.findByRole('region', { name: 'Commander-in-Chief cluster' });
  expect(within(cluster).getByRole('button', { name: 'Open Commander-in-Chief' })).toBeTruthy();
  expect(within(cluster).getByRole('button', { name: 'Message Commander-in-Chief' })).toBeTruthy();
  expect(within(cluster).getByRole('button', { name: /Dictate task in Commander-in-Chief/ })).toBeTruthy();
  const pill = await within(cluster).findByRole('button', { name: /status: 2 needs you · 1 running · 2 done/ });
  expect(pill.textContent).toBe('2 needs you1 running2 done');
  // The commander project is the cluster, not a card in the project list.
  expect(screen.queryByRole('article', { name: 'Project Commander-in-Chief' })).toBeNull();
  expect(screen.getByRole('article', { name: 'Project Freddai' })).toBeTruthy();
  fireEvent.click(within(cluster).getByRole('button', { name: 'Open Commander-in-Chief' }));
  fireEvent.click(pill);
  expect(onOpen).toHaveBeenCalledTimes(2);
});

it('opens the established Commander thread from plus without a separate composer', async () => {
  const client = createFixtureClient(), snapshot = await client.snapshot(new AbortController().signal), onOpen = vi.fn(), onSend = vi.fn();
  render(<CompanionDashboard client={client} snapshot={snapshot} connected onOpen={vi.fn()} onNew={vi.fn()} onOpenCommander={onOpen} onSendCommander={onSend} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Message Commander-in-Chief' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'Message to Commander-in-Chief' })).toBeNull();
});

it('hides the cluster without a commander project or client support', async () => {
  const snapshot = { projects: [{ id: 'x', name: 'X', color: '#000', canStart: true }], threads: [] };
  render(<CompanionDashboard client={createFixtureClient()} snapshot={snapshot} connected onOpen={vi.fn()} onNew={vi.fn()} onOpenCommander={vi.fn()} onSendCommander={vi.fn()} />);
  expect(screen.queryByRole('region', { name: /cluster/ })).toBeNull();
});

it('approves with an edited prompt, then shows the result and a link to the started thread', async () => {
  const respond = vi.fn<CommanderClient['respond']>().mockResolvedValue(proposal({ status: 'approved', result: 'Started a task.', thread: 'th-9', decided_at: 'now' }));
  const onOpenThread = vi.fn();
  render(<ApprovalCard proposal={proposal()} projectName="Lucy Web" respond={respond} onOpenThread={onOpenThread} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Task prompt' }), { target: { value: 'Add a pricing FAQ and a refund policy.' } });
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
  expect((await screen.findByRole('status')).textContent).toContain('Started a task.');
  expect(respond).toHaveBeenCalledWith({ id: 'p1', approve: true, prompt: 'Add a pricing FAQ and a refund policy.' });
  fireEvent.click(screen.getByRole('button', { name: /Open thread/ }));
  expect(onOpenThread).toHaveBeenCalledWith('th-9');
});

it('declines without a prompt and keeps the card actionable with the error when responding fails', async () => {
  const respond = vi.fn<CommanderClient['respond']>().mockRejectedValueOnce(new Error('Mac host unavailable')).mockResolvedValueOnce(proposal({ status: 'declined' }));
  render(<ApprovalCard proposal={proposal()} respond={respond} />);
  fireEvent.click(screen.getByRole('button', { name: /No/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Mac host unavailable');
  // Still pending, so the user can retry.
  fireEvent.click(screen.getByRole('button', { name: /No/ }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Declined'));
  expect(respond).toHaveBeenLastCalledWith({ id: 'p1', approve: false });
});

it('shows a failed approval loudly instead of as success', () => {
  render(<ApprovalCard proposal={proposal({ status: 'failed', error: 'Project folder is missing' })} respond={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Project folder is missing');
});

it('groups to-dos by project in project order, with a trailing No project group', () => {
  const groups = groupMobileTodos([todo('a', 'freddai'), todo('b', 'lucy'), todo('c', null), todo('d', 'lucy'), todo('e', 'gone')], projects);
  expect(groups.map(g => [g.name, g.todos.map(t => t.id)])).toEqual([['Lucy Web', ['b', 'd']], ['Freddai', ['a']], ['No project', ['c', 'e']]]);
});

const data = (over: Partial<CommanderData> = {}): CommanderData => ({ state: null, proposals: [], todos: [], notes: [], error: '', loading: false, refresh: vi.fn(async () => {}), ...over });
const clientWith = (commander: Partial<CommanderClient>): CompanionClient => ({ ...disconnectedClient, commander: commander as CommanderClient });

it('lists to-do owner chips, the verification checklist and a visible action for every needs-you item', async () => {
  const saveTodo = vi.fn(async (t: Partial<Todo>) => todo(t.id!, null, t));
  const review = todo('r', 'lucy', { status: 'needs_review', owner: 'thread', thread: 'th-1', verification: [
    { requirement: 'Dark mode on all cards', status: 'met', evidence: 'screenshot' }, { requirement: 'Contrast checked', status: 'unclear', evidence: null }] });
  render(<CommanderPanel tab="todos" client={clientWith({ saveTodo })} data={data({ todos: [review, todo('o', 'freddai', { owner: 'commander' })] })} projects={projects} onOpenThread={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'To-dos for Lucy Web' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'To-dos for Freddai' })).toBeTruthy();
  expect(screen.getByText('Thread')).toBeTruthy(); expect(screen.getByText('Commander')).toBeTruthy();
  const checklist = screen.getByRole('list', { name: 'Verification' });
  expect(within(checklist).getAllByRole('listitem')).toHaveLength(2);
  expect(within(checklist).getByText('Dark mode on all cards').closest('li')?.getAttribute('data-status')).toBe('met');
  fireEvent.click(screen.getByRole('button', { name: 'Mark "Todo r" done' }));
  await waitFor(() => expect(saveTodo).toHaveBeenCalledWith({ id: 'r', status: 'done', completion_basis: 'user_confirmed' }));
});

it('shows approvals and review to-dos under Waiting and reports a save error', async () => {
  const saveTodo = vi.fn().mockRejectedValue(new Error('disk full'));
  render(<CommanderPanel tab="waiting" client={clientWith({ saveTodo, respond: vi.fn() })} data={data({ proposals: [proposal()], todos: [todo('r', 'lucy', { status: 'needs_review' })] })} projects={projects} onOpenThread={vi.fn()} />);
  expect(screen.getByRole('article', { name: 'Proposal: Start a task in Lucy Web' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Drop "Todo r"' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
});

it('shows the sheet tabs with a waiting badge, reports tab changes and closes from the backdrop', () => {
  const onTab = vi.fn(), onClose = vi.fn();
  render(<CommanderSheet open onClose={onClose} tab="waiting" onTab={onTab} waiting={3}><p>body</p></CommanderSheet>);
  expect(screen.getByRole('dialog', { name: 'Commander' }).getAttribute('data-detent')).toBe('medium');
  expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['To-dos', 'Notes', 'Waiting3', 'Sub-threads', 'Settings']);
  fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
  expect(onTab).toHaveBeenCalledWith('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Expand sheet' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Expand sheet' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Close Commander sheet' }));
  expect(onClose).toHaveBeenCalled();
});

it('opens the Commander chat with a compact header and no pinned tabs or approval, and approves from the avatar sheet', async () => {
  const client = createFixtureClient();
  render(<MobileApp client={client} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dashboard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Commander-in-Chief' }));
  const header = await screen.findByRole('banner', { name: 'Commander-in-Chief header' });
  // Name pill only: no status text block.
  expect(within(header).queryByText(/needs you ·/)).toBeNull();
  // Chat is the main view; the old tab bar and pinned approval card are gone.
  expect(await screen.findByText(/Two things need you/)).toBeTruthy();
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByRole('article', { name: /Proposal: Start a task in Lucy Web/ })).toBeNull();
  // The avatar carries the waiting badge and opens the sheet.
  const avatar = await within(header).findByRole('button', { name: /open To-dos, Notes, Waiting and Sub-threads/ });
  expect(within(header).getByRole('status').textContent).toMatch(/\d/);
  fireEvent.click(avatar);
  expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''))).toEqual(['To-dos', 'Notes', 'Waiting', 'Sub-threads', 'Settings']);
  const card = await screen.findByRole('article', { name: /Proposal: Start a task in Lucy Web/ });
  fireEvent.click(within(card).getByRole('button', { name: /Yes/ }));
  await waitFor(() => expect(within(card).getByRole('status').textContent).toContain('Started a task.'));
  fireEvent.click(screen.getByRole('tab', { name: /To-dos/ }));
  expect(await screen.findByRole('region', { name: 'To-dos for Lucy Web' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
  expect(await screen.findByText('Weekly focus')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close Commander sheet' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {});
});

it('fixture client exposes the commander project and proxies the operations', async () => {
  const client = createFixtureClient();
  const snapshot = await client.snapshot(new AbortController().signal);
  expect(snapshot.projects[0]).toMatchObject({ id: 'commander', kind: 'commander' });
  expect(snapshot.projects[0].objective).toBeTruthy();
  const state = await client.commander!.state();
  expect(state.thread_id).toBe('cmd1');
  expect('path' in state.project).toBe(false);
  expect((await client.commander!.proposals()).filter(p => p.status === 'pending')).toHaveLength(1);
  const declined = await client.commander!.respond({ id: 'fx-prop-1', approve: false });
  expect(declined.status).toBe('declined');
  const saved = await client.commander!.saveTodo({ title: 'Call the accountant', project: 'freddai' });
  expect((await client.commander!.todos()).some(t => t.id === saved.id)).toBe(true);
  expect((await client.commander!.readNote('weekly-focus')).body).toContain('Ship companion Commander');
});

it('lists hidden background work in the avatar sheet and opens it from there', async () => {
  const client = createFixtureClient(), snapshot = await client.snapshot(new AbortController().signal);
  const bg = { ...snapshot.threads[0], id: 'background', project: 'commander', title: 'Background research', status: 'running', origin: { kind: 'commander' } };
  const readSnapshot = client.snapshot;
  client.snapshot = async (...args) => { const data = await readSnapshot(...args); return { ...data, threads: [...data.threads, bg] }; };
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Commander' });
  expect(screen.queryByText('Background research')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Commander' }));
  const header = await screen.findByRole('banner', { name: 'Commander-in-Chief header' });
  fireEvent.click(within(header).getByRole('button', { name: /open To-dos/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Sub-threads' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Background research' }));
  expect(screen.queryByRole('dialog', { name: 'Commander' })).toBeNull();
});

it('continues the main conversation when a new composer targets Commander', async () => {
  const client = createFixtureClient();
  client.start = vi.fn(client.start); client.reply = vi.fn(client.reply);
  render(<MobileApp client={client} />);
  fireEvent.click(await screen.findByRole('button', { name: 'New thread' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'New thread project' }), { target: { value: 'commander' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'New thread prompt' }), { target: { value: 'Review my priorities' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 'cmd1', prompt: 'Review my priorities' })));
  expect(client.start).not.toHaveBeenCalled();
});
