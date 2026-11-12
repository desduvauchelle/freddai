import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenProjectEditor } from './project-editor';
afterEach(cleanup);
it('hides the action when detection fails or the client is unsupported', async () => {
  const available = vi.fn().mockResolvedValue(false);
  render(<OpenProjectEditor client={{ available, open: vi.fn() }} project="p"/>);
  await waitFor(() => expect(available).toHaveBeenCalled());
  expect(screen.queryByRole('button')).toBeNull();
});
it('opens the registered project on the Mac and reports launch failures', async () => {
  const open = vi.fn().mockRejectedValue(new Error('Project folder unavailable'));
  render(<OpenProjectEditor client={{ available: vi.fn().mockResolvedValue(true), open }} project="p" remote/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open in VS Code on Mac' }));
  expect(open).toHaveBeenCalledWith('p');
  expect((await screen.findByRole('alert')).textContent).toContain('Project folder unavailable');
});
