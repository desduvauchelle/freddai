// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageMarkdown } from './MessageMarkdown';
import { LocalhostPreviewChips, PreviewContext, describePreviewError, localhostPreviewUrls, normalizeLocalhostUrl, parsePreviewError } from './localhostPreview';

afterEach(cleanup);

describe('normalizeLocalhostUrl', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000/'],
    ['http://127.0.0.1:5173/app?x=1#h', 'http://localhost:5173/app?x=1#h'],
    ['http://0.0.0.0:8080/a/b', 'http://localhost:8080/a/b'],
    ['http://[::1]:4000/', 'http://localhost:4000/'],
    ['https://localhost:3443/x', 'https://localhost:3443/x'],
  ])('%s', (raw, url) => expect(normalizeLocalhostUrl(raw)?.url).toBe(url));
  it.each(['http://example.com:3000', 'http://localhost', 'http://localhost:0', 'http://localhost:80', 'http://localhost:99999', 'ftp://localhost:3000', 'http://localhost.evil.com:3000'])('ignores %s', raw => expect(normalizeLocalhostUrl(raw)).toBeUndefined());
});

describe('localhostPreviewUrls', () => {
  it('dedupes by port and path', () => {
    expect(localhostPreviewUrls('see http://localhost:3000/a and http://127.0.0.1:3000/a, also http://localhost:3000/b. http://example.com:3000')).toEqual(['http://localhost:3000/a', 'http://localhost:3000/b']);
  });
  it('finds markdown links and trims punctuation', () => {
    expect(localhostPreviewUrls('[app](http://localhost:3000/x). Done: http://localhost:4000.')).toEqual(['http://localhost:3000/x', 'http://localhost:4000/']);
  });
});

describe('Preview chip', () => {
  const text = 'Running at http://localhost:3000/home and http://localhost:3000/home again.';
  it('renders nothing without a companion host', () => {
    render(<MessageMarkdown text={text} />);
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });
  it('opens with the url on tap, one chip per port+path', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    render(<PreviewContext.Provider value={open}><MessageMarkdown text={text} /></PreviewContext.Provider>);
    const chips = screen.getAllByRole('button', { name: /Preview/ });
    expect(chips).toHaveLength(1);
    fireEvent.click(chips[0]);
    await waitFor(() => expect(open).toHaveBeenCalledWith('http://localhost:3000/home'));
  });
  it('shows and logs a rejection', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn().mockRejectedValue('preview_not_granted');
    render(<PreviewContext.Provider value={open}><MessageMarkdown text={text} /></PreviewContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('localhost:3000/home was not shared in this thread.');
    expect(screen.getByRole('alert').textContent).toContain('preview_not_granted');
    expect(err).toHaveBeenCalledWith('preview_open_failed', expect.anything());
  });
});

describe('preview errors', () => {
  it('parses codes, details and non-strings', () => {
    expect(parsePreviewError('preview_server_failed: see /tmp/x.log')).toEqual({ code: 'preview_server_failed', detail: 'see /tmp/x.log' });
    expect(parsePreviewError('preview_not_granted')).toEqual({ code: 'preview_not_granted', detail: '' });
    expect(parsePreviewError(new Error('boom'))).toEqual({ code: 'preview_failed', detail: 'boom' });
    expect(parsePreviewError(42)).toEqual({ code: 'preview_failed', detail: '42' });
    expect(parsePreviewError(new Error('preview_server_starting: still starting')).code).toBe('preview_server_starting');
  });
  it.each([
    ['preview_server_starting', '', 'Starting the server on L…'],
    ['preview_server_confirm', 'npm run dev @ /x', 'Nothing is listening on L. Start it?'],
    ['preview_start_timeout', '90', 'The server for L did not start within 90 s.'],
    ['preview_server_failed', 'log at /x', 'The server for L exited. log at /x'],
    ['preview_port_unreachable', '', 'Nothing is listening on L. Ask the agent to start the server, or to share it with a start command.'],
    ['preview_not_granted', '', 'L was not shared in this thread.'],
    ['preview_tunnel_unavailable', 'down', 'Could not reach the Freddai relay. down'],
    ['preview_invalid_url', 'bad', 'Preview failed: preview_invalid_url (bad)'],
    ['weird', '', 'Preview failed: weird'],
  ])('describes %s', (code, detail, text) => expect(describePreviewError(code, detail, 'L')).toBe(text));
});

describe('Preview chip retry', () => {
  const text = 'at http://localhost:3000/';
  const retry = { intervalMs: 100, totalMs: 1000 };
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('retries while starting, then succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn().mockRejectedValueOnce('preview_server_starting').mockRejectedValueOnce('preview_server_starting').mockResolvedValue(undefined);
    render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} retry={retry} /></PreviewContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(screen.getByRole('status').textContent).toBe('Starting the server on localhost:3000/…');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button').textContent).toContain('Starting');
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(open).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button').textContent).toContain('Preview');
  });
  it('gives up after totalMs with the code visible', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn().mockRejectedValue('preview_server_starting');
    render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} retry={retry} /></PreviewContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('alert').textContent).toContain('preview_start_timeout');
    expect(screen.getByRole('alert').textContent).toContain('did not start within 1 s');
    const calls = open.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(open).toHaveBeenCalledTimes(calls);
  });
  it('stops on a non-starting error and shows it', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn().mockRejectedValueOnce('preview_server_starting').mockRejectedValue('preview_server_failed: log at /x');
    render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} retry={retry} /></PreviewContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('alert').textContent).toContain('The server for localhost:3000/ exited. log at /x');
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('unmount clears the retry timer', async () => {
    vi.useFakeTimers();
    const open = vi.fn().mockRejectedValue('preview_server_starting');
    const { unmount } = render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} retry={retry} /></PreviewContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(open).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('shows a non-string error with preview_failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn().mockRejectedValue(new Error('boom'));
    render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} /></PreviewContext.Provider>);
    fireEvent.click(screen.getByRole('button'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Preview failed: preview_failed (boom)');
  });
});

describe('Preview chip confirm', () => {
  const text = 'at http://localhost:3000/';
  const retry = { intervalMs: 100, totalMs: 1000 };
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('asks, then starts and keeps retrying with start:true', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.fn()
      .mockRejectedValueOnce('preview_server_confirm: npm run dev @ /Users/x/app')
      .mockRejectedValueOnce('preview_server_starting')
      .mockRejectedValueOnce('preview_server_starting')
      .mockResolvedValue(undefined);
    render(<PreviewContext.Provider value={open}><LocalhostPreviewChips text={text} retry={retry} /></PreviewContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Preview/ })); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith('http://localhost:3000/');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nothing is listening on localhost:3000/. Start it?');
    expect(alert.querySelector('code')?.textContent).toBe('npm run dev');
    expect(alert.textContent).toContain('in ~/app');
    expect(alert.textContent).toContain('preview_server_confirm');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(open).toHaveBeenCalledTimes(1); // no retry loop while waiting for the user
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start server for localhost:3000/' })); });
    expect(open).toHaveBeenLastCalledWith('http://localhost:3000/', { start: true });
    expect(screen.getByRole('status').textContent).toContain('Starting the server');
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(open).toHaveBeenCalledTimes(4);
    expect(open.mock.calls.slice(1)).toEqual([[ 'http://localhost:3000/', { start: true } ], [ 'http://localhost:3000/', { start: true } ], [ 'http://localhost:3000/', { start: true } ]]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /Start server/ })).toBeNull();
  });
});
