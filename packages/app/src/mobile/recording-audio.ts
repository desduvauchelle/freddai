/** The Mac's local decoder accepts AAC/M4A and PCM WAV, not WebM/Opus. */
export function monoWav(audio: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>): Blob {
  const rate = 16000, count = Math.floor(audio.length * rate / audio.sampleRate);
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  for (let i = 0; i < count; i++) {
    const position = i * audio.sampleRate / rate, left = Math.floor(position), right = Math.min(left + 1, audio.length - 1), fraction = position - left;
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, data) => sum + data[left] * (1 - fraction) + data[right] * fraction, 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function macCompatibleRecording(recording: Blob): Promise<Blob> {
  if (/mp4|aac|wav/.test(recording.type)) return recording;
  const context = new AudioContext();
  try { return monoWav(await context.decodeAudioData(await recording.arrayBuffer())); }
  finally { await context.close(); }
}
