// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageMarkdown } from './MessageMarkdown';
import { PreviewContext, localhostPreviewUrls, normalizeLocalhostUrl } from './localhostPreview';

afterEach(cleanup);

describe('normalizeLocalhostUrl', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000/'],
    ['http://127.0.0.1:5173/app?x=1#h', 'http://localhost:5173/app?x=1#h'],
    ['http://0.0.0.0:8080/a/b', 'http://localhost:8080/a/b'],
    ['http://[::1]:4000/', 'http://localhost:4000/'],
    ['https://localhost:3443/x', 'https://localhost:3443/x'],
  ])('%s', (raw, url) => expect(normalizeLocalhostUrl(raw)?.url).toBe(url));
  it.each(['http://example.com:3000', 'http://localhost', 'http://localhost:0', 'http://localhost:99999', 'ftp://localhost:3000', 'http://localhost.evil.com:3000'])('ignores %s', raw => expect(normalizeLocalhostUrl(raw)).toBeUndefined());
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
    expect((await screen.findByRole('alert')).textContent).toBe('Preview failed: preview_not_granted');
    expect(err).toHaveBeenCalledWith('preview_open_failed', expect.anything());
  });
});
