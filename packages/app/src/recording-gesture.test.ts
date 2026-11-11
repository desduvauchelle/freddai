import { expect, it } from 'vitest';
import { recordingGesture, recordingCueOffset } from './recording-gesture';
it('uses the same dominant-direction thresholds and resets when the finger returns', () => {
  const origin = { x: 300, y: 400 };
  expect(recordingGesture(origin, { x: 204, y: 370 })).toMatchObject({ shouldCancel: true, send: 0 });
  expect(recordingGesture(origin, { x: 280, y: 336 })).toMatchObject({ shouldSend: true, cancel: 0 });
  expect(recordingGesture(origin, origin)).toMatchObject({ cancel: 0, send: 0 });
});
it('projects diagonal finger movement onto one rail without drifting or retaining a previous offset', () => {
  const rest = { x: 50, y: 100 }, finger = { x: 190, y: 200 };
  expect(recordingCueOffset(rest, finger, 0.5, 'horizontal')).toEqual({ x: 105, y: 0 });
  expect(recordingCueOffset(rest, finger, 0.5, 'vertical')).toEqual({ x: 0, y: 75 });
  expect(recordingCueOffset(rest, finger, 0, 'vertical')).toEqual({ x: 0, y: 0 });
});
