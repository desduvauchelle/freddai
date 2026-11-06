// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneratedFileContext, type FileChunk } from './GeneratedFile';
import { MessageMarkdown } from './MessageMarkdown';
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
