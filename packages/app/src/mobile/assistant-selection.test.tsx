import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';
import { disconnectedClient, type CompanionSnapshot } from './companion';
afterEach(cleanup);
beforeAll(() => {
  window.matchMedia ||= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});
it('starts with the selected assistant and preserves the prompt through polling', async () => {
  const data: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'First', provider: 'codex' }, { id: 'b', name: 'Second', provider: 'claude' }] }], threads: [] };
  const start = vi.fn(async () => 'new-thread');
  render(<MobileApp client={{ ...disconnectedClient, snapshot: async () => structuredClone(data), start }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'New thread' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'New thread project' }), { target: { value: 'p' } });
  expect((screen.getByRole('combobox', { name: 'Coding assistant' }) as HTMLSelectElement).value).toBe('a');
  fireEvent.change(screen.getByRole('textbox', { name: 'New thread prompt' }), { target: { value: 'Synthetic task' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Coding assistant' }), { target: { value: 'b' } });
  fireEvent(document, new Event('visibilitychange')); 
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Coding assistant' }) as HTMLSelectElement).value).toBe('b'));
  fireEvent.submit(screen.getByRole('textbox', { name: 'New thread prompt' }).closest('form')!);
  await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ assistant: 'b', project: 'p', prompt: 'Synthetic task', options: expect.objectContaining({ permission_mode: 'bypass' }) })));
});
