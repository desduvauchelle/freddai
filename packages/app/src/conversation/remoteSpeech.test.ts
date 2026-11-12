import { expect, it, vi } from 'vitest';
import { remoteSpeech } from './remoteSpeech';
import type { SpeechConnection } from '../desktop/commander/SpeechSettings';
it('uses local speech only when the saved provider is local', async () => {
  const player = remoteSpeech(vi.fn().mockResolvedValue({ local: true }) as SpeechConnection, vi.fn());
  expect(await player.speak('Hello')).toBe(false);
});
it('does not play an old remote response after hangup or interruption', async () => {
  let resolve!: (value: unknown) => void;
  const call = vi.fn(() => new Promise(r => { resolve = r; })) as SpeechConnection;
  const emit = vi.fn(), player = remoteSpeech(call, emit);
  const pending = player.speak('Hello'); player.stop(); resolve({ dataUrl: 'data:audio/mpeg;base64,AA==' });
  expect(await pending).toBe(true); expect(emit).not.toHaveBeenCalled();
});
it('reports remote errors without silently switching providers', async () => {
  const player = remoteSpeech(vi.fn().mockRejectedValue(new Error('HTTP 401')) as SpeechConnection, vi.fn());
  await expect(player.speak('Hello')).rejects.toThrow('401');
});
