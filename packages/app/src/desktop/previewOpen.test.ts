import { describe, expect, it, vi } from 'vitest';
import { makeDesktopPreviewOpen } from './previewOpen';

describe('makeDesktopPreviewOpen', () => {
  it('opens the caller url (scheme and fragment kept) and passes start', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'listening', url: 'http://localhost:5173/' });
    const openInPanel = vi.fn();
    const open = makeDesktopPreviewOpen({ threadId: 't1', invoke, openInPanel });
    await open('https://localhost:5173/#/route');
    expect(invoke).toHaveBeenLastCalledWith('preview_open', { threadId: 't1', url: 'https://localhost:5173/#/route', start: false });
    expect(openInPanel).toHaveBeenCalledWith('https://localhost:5173/#/route');
    await open('https://localhost:5173/#/route', { start: true });
    expect(invoke).toHaveBeenLastCalledWith('preview_open', { threadId: 't1', url: 'https://localhost:5173/#/route', start: true });
  });
  it('rejects any non-listening status as preview_invalid_response', async () => {
    const openInPanel = vi.fn();
    const open = makeDesktopPreviewOpen({ threadId: 't1', invoke: vi.fn().mockResolvedValue({ status: 'starting', url: 'u' }), openInPanel });
    await expect(open('u')).rejects.toThrow('preview_invalid_response: starting');
    expect(openInPanel).not.toHaveBeenCalled();
  });
  it('passes invoke rejections through unchanged', async () => {
    const open = makeDesktopPreviewOpen({ threadId: 't1', invoke: vi.fn().mockRejectedValue('preview_server_confirm: npm run dev @ /x'), openInPanel: vi.fn() });
    await expect(open('u')).rejects.toBe('preview_server_confirm: npm run dev @ /x');
  });
});
