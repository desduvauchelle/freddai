import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { CompanionSettings } from './CompanionSettings';
import { useSatelliteMode } from './satellite';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('./satellite', () => ({ useSatelliteMode: vi.fn() }));
const devices = { code: null, expires: null, pending: null, devices: [], relay: null };
beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (command: string) => command === 'companion_devices' ? devices : undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('offers satellite setup on a normal Mac', async () => {
  vi.mocked(useSatelliteMode).mockReturnValue(false);
  render(<CompanionSettings native />);
  fireEvent.click(await screen.findByRole('button', { name: /Set up Mac satellite/ }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('satellite_set_mode', { enabled: true }));
  expect(screen.queryByText('This Mac is a satellite. Work runs on your original Mac.')).toBeNull();
  expect(screen.getByText('Paired devices')).toBeTruthy();
});

it('shows the satellite block with reconnect and local-mode actions on a satellite Mac', async () => {
  vi.mocked(useSatelliteMode).mockReturnValue(true);
  const paired = vi.fn();
  window.addEventListener('freddai:satellite-pair', paired);
  render(<CompanionSettings native />);
  expect(await screen.findByText('This Mac is a satellite. Work runs on your original Mac.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Set up Mac satellite/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connect to another Mac' }));
  expect(paired).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /Use this Mac locally/ }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('satellite_set_mode', { enabled: false }));
  expect(screen.getByText('Paired devices')).toBeTruthy();
  window.removeEventListener('freddai:satellite-pair', paired);
});
