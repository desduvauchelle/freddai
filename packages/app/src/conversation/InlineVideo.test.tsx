// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GeneratedFileContext, type FileChunk } from './GeneratedFile';
import { MessageMarkdown } from './MessageMarkdown';

const MIB = 1024 * 1024;
const SIZE = 10 * MIB; // 64 KiB probe, then 4 + 4 + 2 MiB.
const bytes = (n: number) => btoa('a'.repeat(n));
const chunk = (offset: number, length: number, extra: Partial<FileChunk> = {}): FileChunk => ({ mime: 'video/mp4', size: SIZE, offset, data: bytes(Math.min(length, SIZE - offset)), path: '/tmp/clip.mp4', kind: 'video', ...extra });
const videoReader = () => vi.fn<(href: string, offset: number, length?: number) => Promise<FileChunk>>(async (_h, offset, length) => chunk(offset, length ?? 192 * 1024));
const created: Blob[] = [];
beforeEach(() => {
  created.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return `blob:test/${created.length}`; });
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
const mount = (text: string, read: ReturnType<typeof videoReader>) => render(<GeneratedFileContext.Provider value={read}><MessageMarkdown text={text} /></GeneratedFileContext.Provider>);

it('shows a card after a single 64 KiB probe, and downloads only after Play', async () => {
  const read = videoReader();
  const { container } = mount('[Clip](/tmp/clip.mp4)', read);
  const card = await screen.findByRole('button', { name: 'Play video: Clip' });
  await waitFor(() => expect(card.textContent).toContain('Play · 10.0 MB'));
  expect(read.mock.calls).toEqual([['/tmp/clip.mp4', 0, 65536]]);
  expect(container.querySelector('video')).toBeNull();
  fireEvent.click(card);
  await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:test/1'));
  expect(read.mock.calls.slice(1)).toEqual([['/tmp/clip.mp4', 0, 4 * MIB], ['/tmp/clip.mp4', 4 * MIB, 4 * MIB], ['/tmp/clip.mp4', 8 * MIB, 4 * MIB]]);
  expect(created[0].size).toBe(SIZE);
  expect(created[0].type).toBe('video/mp4');
  expect(container.querySelector('video')?.hasAttribute('controls')).toBe(true);
});

it('shows progress while the file loads', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const read = videoReader();
  read.mockImplementation(async (_h, offset, length) => { if (offset === 4 * MIB) await gate; return chunk(offset, length ?? 0); });
  mount('[Clip](/tmp/clip.mp4)', read);
  fireEvent.click(await screen.findByRole('button', { name: 'Play video: Clip' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play video: Clip' }).textContent).toContain('Loading 40% (4.0 MB of 10.0 MB)'));
  expect(screen.getByLabelText('Loading progress')).toBeTruthy();
  release();
  await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
});

it('reports reader errors inline right away', async () => {
  const read = vi.fn().mockRejectedValue(new Error('File unavailable on your Mac'));
  mount('[Clip](/tmp/clip.mp4)', read);
  expect((await screen.findByRole('alert')).textContent).toContain('File unavailable on your Mac');
});

it('warns about large files but still allows play', async () => {
  const read = videoReader();
  read.mockImplementation(async (_h, offset) => chunk(offset, 10, { size: 200 * MIB }));
  mount('[Big](/tmp/big.mov)', read);
  const card = await screen.findByRole('button', { name: 'Play video: Big' });
  await waitFor(() => expect(card.textContent).toContain('Large file (200 MB)'));
  expect((card as HTMLButtonElement).disabled).toBe(false);
});

it('renders bare ~/ paths in prose and inline code as cards', async () => {
  const read = videoReader();
  mount('Done: ~/Movies/a.mov and `/tmp/b.webm`', read);
  expect(await screen.findByRole('button', { name: 'Play video: a.mov' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play video: b.webm' })).toBeTruthy();
});

it('plays hosted video directly from its URL', () => {
  const read = videoReader();
  const { container } = mount('https://x.test/a.mp4', read);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('https://x.test/a.mp4');
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Expand video: a.mp4' }));
  expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy();
});

it('falls back to a link when a hosted video fails', () => {
  const { container } = mount('[Demo](https://x.test/a.mp4)', videoReader());
  fireEvent.error(container.querySelector('video')!);
  expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
});

it('renders local audio with an audio element after Play', async () => {
  const read = videoReader();
  read.mockImplementation(async (_h, offset, length) => chunk(offset, length ?? 0, { mime: 'audio/mp4', kind: 'audio' }));
  const { container } = mount('/tmp/a.m4a', read);
  fireEvent.click(await screen.findByRole('button', { name: 'Play audio: a.m4a' }));
  await waitFor(() => expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:test/1'));
  expect(container.querySelector('video')).toBeNull();
});

it('expands the loaded video into the lightbox with path actions without re-downloading', async () => {
  const read = videoReader();
  const { container } = mount('[Clip](/tmp/clip.mp4)', read);
  fireEvent.click(await screen.findByRole('button', { name: 'Play video: Clip' }));
  await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
  const calls = read.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Expand video: Clip' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('video')?.getAttribute('src')).toBe('blob:test/1');
  expect(screen.getByRole('button', { name: 'Copy path' })).toBeTruthy();
  expect(read.mock.calls.length).toBe(calls);
});

it('revokes the object URL on unmount', async () => {
  const read = videoReader();
  const { container, unmount } = mount('[Clip](/tmp/clip.mp4)', read);
  fireEvent.click(await screen.findByRole('button', { name: 'Play video: Clip' }));
  await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
});

it('still sends non-media files to the not-previewable dialog', async () => {
  const read = vi.fn().mockResolvedValue({ mime: 'application/zip', size: 2, offset: 0, data: '', path: '/tmp/a.zip', previewable: false, kind: 'other' });
  mount('[Archive](/tmp/a.zip)', read);
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect((await screen.findByText('This file type cannot be previewed here.'))).toBeTruthy();
});
