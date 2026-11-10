import { expect, it } from 'vitest';
import { monoWav, macCompatibleRecording } from './recording-audio';
it('leaves native AAC recordings untouched', async () => {
  const audio = new Blob(['aac'], { type: 'audio/mp4' });
  expect(await macCompatibleRecording(audio)).toBe(audio);
});
it('encodes bounded 16kHz mono PCM with mixed channels and a valid WAV header', async () => {
  const wav = monoWav({ sampleRate: 32000, length: 4, numberOfChannels: 2,
    getChannelData: channel => new Float32Array(channel ? [-1, 0, 1, 0] : [1, 0, 1, 0]) });
  const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(wav); });
  const view = new DataView(bytes);
  expect(wav.type).toBe('audio/wav'); expect(bytes.byteLength).toBe(48);
  expect(view.getUint32(24, true)).toBe(16000); expect(view.getUint16(22, true)).toBe(1);
  expect(view.getInt16(44, true)).toBe(0); expect(view.getInt16(46, true)).toBe(32767);
});
