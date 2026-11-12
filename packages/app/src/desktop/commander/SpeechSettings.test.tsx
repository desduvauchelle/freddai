import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpeechSettings, type SpeechConnection } from './SpeechSettings';
afterEach(cleanup);
const state = { settings: { transcription: 'local', speech: 'local', transcriptionModel: 'openai/whisper-1', speechModel: 'openai/tts-1', voice: 'alloy' }, keys: { openrouter: false, vercel: true } };
it('saves separate providers and clears the key field after the host acknowledges it', async () => {
  const call = vi.fn().mockResolvedValue(state);
  render(<SpeechSettings connection={call as SpeechConnection} />);
  fireEvent.change(await screen.findByLabelText('Voice to text'), { target: { value: 'openrouter' } });
  fireEvent.change(screen.getByLabelText('Text to voice'), { target: { value: 'vercel' } });
  fireEvent.change(screen.getByLabelText(/OpenRouter API key/), { target: { value: 'test-only-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice connections' }));
  await screen.findByText('Saved');
  expect(call).toHaveBeenLastCalledWith('save', { settings: { ...state.settings, transcription: 'openrouter', speech: 'vercel' }, keys: { openrouter: 'test-only-secret' } });
  expect((screen.getByLabelText(/OpenRouter API key/) as HTMLInputElement).value).toBe('');
});
it('keeps input and reports a rejected save', async () => {
  const call = vi.fn().mockResolvedValueOnce(state).mockRejectedValue(new Error('Keychain denied'));
  render(<SpeechSettings connection={call as SpeechConnection} />);
  fireEvent.change(await screen.findByLabelText(/OpenRouter API key/), { target: { value: 'test-only-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice connections' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Keychain denied'));
  expect((screen.getByLabelText(/OpenRouter API key/) as HTMLInputElement).value).toBe('test-only-secret');
});
