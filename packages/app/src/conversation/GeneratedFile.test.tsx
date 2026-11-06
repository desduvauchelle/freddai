// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneratedFileContext, type FileChunk } from './GeneratedFile';
import { MessageMarkdown } from './MessageMarkdown';
afterEach(cleanup);
it('loads a referenced image on demand and assembles chunks into the viewer', async () => {
  const read = vi.fn<(href: string, offset: number) => Promise<FileChunk>>()
    .mockResolvedValueOnce({ mime: 'image/png', size: 6, offset: 0, data: btoa('abc') })
    .mockResolvedValueOnce({ mime: 'image/png', size: 6, offset: 3, data: btoa('def') });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Design](/tmp/design.png)" /></GeneratedFileContext.Provider>);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Design' }));
  const image = await screen.findByRole('img');
  expect(image.getAttribute('src')).toBe(`data:image/png;base64,${btoa('abcdef')}`);
  expect(read.mock.calls).toEqual([['/tmp/design.png', 0], ['/tmp/design.png', 3]]);
});
it('reports a missing file without navigating away', async () => {
  const read = vi.fn().mockRejectedValue(new Error('File unavailable on your Mac'));
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[Design](sandbox:/mnt/data/design.png)" /></GeneratedFileContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Design' }));
  expect((await screen.findByRole('alert')).textContent).toContain('File unavailable');
  expect(read).toHaveBeenCalledWith('sandbox:/mnt/data/design.png', 0);
});
it('loads PDFs in the preview', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'application/pdf', size: 6, offset: 0, data: btoa('%PDF-x') });
  render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text="[A4 PDF](file:///tmp/design.pdf)" /></GeneratedFileContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'A4 PDF' }));
  expect((await screen.findByTitle('PDF preview')).getAttribute('src')).toContain('data:application/pdf;base64,');
});
