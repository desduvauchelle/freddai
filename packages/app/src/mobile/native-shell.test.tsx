import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { isNativeShell, probeNativeShell } from './native-shell';
import { MobileApp } from './MobileApp';
import { disconnectedClient, type CompanionClient } from './companion';

afterEach(cleanup);

beforeAll(() => {
  window.matchMedia ||= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as never;
});

it('is not a native shell outside the Tauri iOS build', async () => {
  expect(isNativeShell()).toBe(false);
  expect(await probeNativeShell()).toBe(false);
  expect(isNativeShell()).toBe(false);
});

it('keeps the web header and composer in a conversation when the native shell is unavailable', async () => {
  const client: CompanionClient = {
    ...disconnectedClient,
    async snapshot() {
      return {
        projects: [{ id: 'p', name: 'Project', canStart: true } as never],
        threads: [{ id: 't', project: 'p', title: 'Hello thread', status: 'done', updated: 1, messages: [], canReply: true, queued: 0, error: null }],
      };
    },
  };
  render(<MobileApp client={client} />);
  fireEvent.click((await screen.findAllByRole('button', { name: /Hello thread/ }))[0]);
  expect(await screen.findByRole('textbox', { name: 'Reply' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thread actions' })).toBeTruthy();
});
