/** Desktop `preview_open`: asks the Mac to make sure the dev server is up (optionally starting it after user confirmation), then opens the caller's URL in the side panel. */
export type PreviewOpenResult = { status: string; url?: string };

export function makeDesktopPreviewOpen({ threadId, invoke, openInPanel }: {
  threadId: string;
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  openInPanel: (url: string) => void;
}): (url: string, opts?: { start?: boolean }) => Promise<void> {
  return async (url, opts) => {
    const r = await invoke('preview_open', { threadId, url, start: !!opts?.start }) as PreviewOpenResult;
    if (r?.status === 'listening') { openInPanel(url); return; }
    throw new Error(`preview_invalid_response: ${String(r?.status)}`);
  };
}
