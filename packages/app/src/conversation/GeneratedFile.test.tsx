// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneratedFileContext, LocalPageContext, PathActions, type FileChunk } from './GeneratedFile';
import { MessageMarkdown } from './MessageMarkdown';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn().mockResolvedValue(true) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemInDir: vi.fn() }));
afterEach(cleanup);
it('renders a referenced image inline as a thumbnail, then opens a lightbox with path actions', async () => {
  const read = vi.fn<(href: string, offset: number) => Promise<FileChunk>>()
    .mockResolvedValueOnce({ mime: 'image/png', size: 6, offset: 0, data: btoa('abc'), path: '/Users/me/design.png' })
    .mockResolvedValueOnce({ mime: 'image/png', size: 6, offset: 3, data: btoa('def'), path: '/Users/me/design.png' });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Design](/tmp/design.png)" /></GeneratedFileContext.Provider>);
  const thumb = await screen.findByRole('img', { name: 'Design' });
  expect(thumb.getAttribute('src')).toBe(`data:image/png;base64,${btoa('abcdef')}`);
  expect(read.mock.calls).toEqual([['/tmp/design.png', 0], ['/tmp/design.png', 3]]);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open image: Design' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe(thumb.getAttribute('src'));
  expect(screen.getByText('/Users/me/design.png')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy path' })).toBeTruthy();
});
it('renders markdown image syntax inline too', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'image/webp', size: 3, offset: 0, data: btoa('abc') });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="![chart](out/chart.webp)" /></GeneratedFileContext.Provider>);
  expect((await screen.findByRole('img', { name: 'chart' })).getAttribute('src')).toContain('data:image/webp;base64,');
});
it('reports a missing image inline without navigating away', async () => {
  const read = vi.fn().mockRejectedValue(new Error('File unavailable on your Mac'));
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Design](sandbox:/mnt/data/design.png)" /></GeneratedFileContext.Provider>);
  expect((await screen.findByRole('alert')).textContent).toContain('File unavailable');
  expect(read).toHaveBeenCalledWith('sandbox:/mnt/data/design.png', 0);
});
it('loads PDFs in the preview', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'application/pdf', size: 6, offset: 0, data: btoa('%PDF-x') });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[A4 PDF](file:///tmp/design.pdf)" /></GeneratedFileContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'A4 PDF' }));
  expect((await screen.findByTitle('PDF preview')).getAttribute('src')).toContain('data:application/pdf;base64,');
});
it('renders HTML in a fully sandboxed frame, decodes UTF-8 and shows the resolved path', async () => {
  const html = '<h1>Café ☕</h1>';
  const data = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
  const read = vi.fn().mockResolvedValue({ mime: 'text/html', size: new TextEncoder().encode(html).length, offset: 0, data, path: '/Users/me/proj/output/email-demo.html' });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Open the HTML email demo](output/email-demo.html)" /></GeneratedFileContext.Provider>);
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open the HTML email demo' }));
  const frame = await screen.findByTitle('HTML preview');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toBe(html);
  expect(screen.getByText('/Users/me/proj/output/email-demo.html')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy path' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).toBeNull();
});
it('shows text files in a scrollable block', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'text/csv', size: 3, offset: 0, data: btoa('a,b'), path: '/tmp/x.csv' });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[data](x.csv)" /></GeneratedFileContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'data' }));
  expect((await screen.findByText('a,b')).tagName).toBe('PRE');
});
it('makes unpreviewable local files actionable with their path', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'application/octet-stream', size: 2, offset: 0, data: '', path: '/Users/me/proj/dist/app.zip', previewable: false });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Bundle](dist/app.zip)" /></GeneratedFileContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Bundle' }));
  expect(await screen.findByText('/Users/me/proj/dist/app.zip')).toBeTruthy();
  expect(screen.getByText(/cannot be previewed/)).toBeTruthy();
});
it('renders a bare local path inline, passing the exact href to the reader', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'image/png', size: 3, offset: 0, data: btoa('abc'), path: '/abs/path/x.png' });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="Saved to /abs/path/x.png" /></GeneratedFileContext.Provider>);
  expect((await screen.findByRole('img', { name: 'x.png' })).getAttribute('src')).toContain('data:image/png;base64,');
  expect(read).toHaveBeenCalledWith('/abs/path/x.png', 0);
});
it('renders inline-code paths and keeps trailing punctuation', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'image/webp', size: 3, offset: 0, data: btoa('abc') });
  const { container } = render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text={'`~/a/b.webp`\n\nsee out/chart.png.'} /></GeneratedFileContext.Provider>);
  await screen.findByRole('img', { name: 'b.webp' });
  await screen.findByRole('img', { name: 'chart.png' });
  expect(read.mock.calls.map(c => c[0]).sort()).toEqual(['out/chart.png', '~/a/b.webp']);
  expect(container.textContent).toContain('.');
});
it('leaves paths in fenced code untouched', () => {
  const read = vi.fn();
  const { container } = render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text={'```\n/usr/bin/python\nfoo.png\n```'} /></GeneratedFileContext.Provider>);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('pre')?.textContent).toContain('/usr/bin/python');
  expect(read).not.toHaveBeenCalled();
});
it.each(['https://x.test/a.png?x=1', '![](https://x.test/a.png?x=1)', '[pic](https://x.test/a.png?x=1)'])('renders hosted image %s with a lightbox and link actions', async text => {
  const { container } = render(<MessageMarkdown text={text} />);
  const thumb = container.querySelector('.generated-thumb-button img');
  expect(thumb?.getAttribute('src')).toBe('https://x.test/a.png?x=1');
  fireEvent.click(screen.getByRole('button', { name: /Open image/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://x.test/a.png?x=1');
  expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
});
it('shows a link fallback when a hosted image fails to load', () => {
  const { container } = render(<MessageMarkdown text="https://x.test/a.png" />);
  fireEvent.error(container.querySelector('.generated-thumb-button img')!);
  expect(screen.getByRole('alert').querySelector('a')?.getAttribute('href')).toBe('https://x.test/a.png');
});
it('keeps non-image URLs as normal web links', () => {
  const { container } = render(<MessageMarkdown text="https://x.test/page" />);
  expect(container.querySelector('a[href="https://x.test/page"]')).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
});

const png = (p: string) => vi.fn().mockResolvedValue({ mime: 'image/png', size: 3, offset: 0, data: btoa('abc'), path: p });
it('keeps non-ASCII markdown image hrefs literal for the host', async () => {
  const read = png('/tmp/café.png');
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="![a](/tmp/café.png)" /></GeneratedFileContext.Provider>);
  await screen.findByRole('img', { name: 'a' });
  expect(read).toHaveBeenCalledWith('/tmp/café.png', 0);
});
it('detects bare non-ASCII paths but not ones with whitespace', async () => {
  const read = png('/tmp/café.png');
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="Saved /tmp/café.png and /tmp/café 2.png ok" /></GeneratedFileContext.Provider>);
  await screen.findByRole('img', { name: 'café.png' });
  expect(read.mock.calls.map(c => c[0])).toEqual(['/tmp/café.png']);
});
it('does not decode a path written with a literal %20', async () => {
  const read = png('/tmp/a%20b.png');
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="Saved /tmp/a%20b.png" /></GeneratedFileContext.Provider>);
  await screen.findByRole('img');
  expect(read).toHaveBeenCalledWith('/tmp/a%20b.png', 0);
});
it('says a file is too large instead of "changed while loading"', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'image/png', size: 30 * 1048576, offset: 0, data: btoa('abc') });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="Saved /tmp/big.png" /></GeneratedFileContext.Provider>);
  expect((await screen.findByRole('alert')).textContent).toContain('File too large to preview (30 MB)');
});
it('says an empty file is empty', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'image/png', size: 0, offset: 0, data: '' });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="Saved /tmp/e.png" /></GeneratedFileContext.Provider>);
  expect((await screen.findByRole('alert')).textContent).toContain('File is empty');
});
it('sends no referrer for hosted video and audio', () => {
  const { container } = render(<MessageMarkdown text="![v](https://x.test/a.mp4) ![s](https://x.test/a.mp3)" />);
  expect(container.querySelector('video')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(container.querySelector('audio')?.getAttribute('referrerpolicy')).toBe('no-referrer');
});
it('shows the real resolver error when opening a satellite file fails', async () => {
  const resolve = vi.fn().mockRejectedValue(new Error('Host offline'));
  render(<LocalPageContext.Provider value={resolve}><PathActions path="/Users/me/a.html" href="/Users/me/a.html" /></LocalPageContext.Provider>);
  await screen.findByRole('button', { name: 'Open in default app' });
  await new Promise(r => setTimeout(r, 0));
  fireEvent.click(screen.getByRole('button', { name: 'Open in default app' }));
  expect((await screen.findByRole('alert')).textContent).toContain("This file is on your original Mac and can't be opened here: Host offline");
});
it('uses the plain original-Mac message when no resolver exists', async () => {
  render(<PathActions path="/Users/me/a.html" href="/Users/me/a.html" />);
  await new Promise(r => setTimeout(r, 0));
  fireEvent.click(screen.getByRole('button', { name: 'Open in default app' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This file is on your original Mac.');
});
