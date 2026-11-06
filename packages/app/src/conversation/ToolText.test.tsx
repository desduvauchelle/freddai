import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolActivity } from './ToolActivity';
import { ToolTextContext, type ToolTextPage } from './ToolText';

afterEach(cleanup);
const call = { id: 'tool', role: 'tool', text: '{}', toolTextBytes: 100000, toolTextHash: 'v1' };
function openDetails(element: HTMLDetailsElement, open = true) { element.open = open; fireEvent(element, new Event('toggle')); }

it('loads only opened output, retains one page, and releases it on close', async () => {
  const read = vi.fn(async (_id: string, offset: number) => ({ text: offset ? 'second page' : 'first page', offset, nextOffset: offset ? null : 65536, totalBytes: 100000, hash: 'v1' }));
  const { container } = render(<ToolTextContext.Provider value={read}><ToolActivity messages={[call]} /></ToolTextContext.Provider>);
  expect(read).not.toHaveBeenCalled();
  const group = container.querySelector('details')!;
  openDetails(group);
  const summary = await screen.findByText('Call 1');
  expect(read).not.toHaveBeenCalled();
  const detail = summary.closest('details')!;
  openDetails(detail);
  await screen.findByText('first page');
  expect(read).toHaveBeenCalledWith('tool', 0, 'v1');
  fireEvent.click(screen.getByText('More output'));
  await screen.findByText('second page');
  expect(screen.queryByText('first page')).toBeNull();
  fireEvent.click(screen.getByText('Previous output'));
  await screen.findByText('first page');
  openDetails(detail, false);
  await waitFor(() => expect(container.querySelector('pre')).toBeNull());
  openDetails(detail);
  await screen.findByText('first page');
  expect(read).toHaveBeenCalledTimes(4);
});

it('ignores late results after closing and exposes retry on failure', async () => {
  let resolve!: (page: ToolTextPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<ToolTextPage>(done => { resolve = done; })).mockRejectedValueOnce(new Error('Temporarily unavailable')).mockResolvedValue({ text: 'recovered', offset: 0, nextOffset: null, totalBytes: 9, hash: 'v1' });
  const { container } = render(<ToolTextContext.Provider value={read}><ToolActivity messages={[call]} /></ToolTextContext.Provider>);
  openDetails(container.querySelector('details')!);
  const detail = (await screen.findByText('Call 1')).closest('details')!;
  openDetails(detail); await screen.findByRole('status');
  openDetails(detail, false);
  await act(async () => resolve({ text: 'stale', offset: 0, nextOffset: null, totalBytes: 5, hash: 'v1' }));
  expect(screen.queryByText('stale')).toBeNull();
  openDetails(detail); await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Retry')); await screen.findByText('recovered');
});
