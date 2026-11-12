import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingFeedback } from './RecordingFeedback';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([[0, 0], [980, 0], [0, 700], [980, 700]])('keeps feedback visible at viewport corner %s,%s', (x, y) => {
  let anchor = { left: x, right: x + 32, top: y, bottom: y + 32, width: 32, height: 32, x, y, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => anchor);
  render(<div style={{ overflow: 'hidden' }}><RecordingFeedback elapsed={0} send={0} cancel={0} finger={null} onCancel={() => {}} onSend={() => {}} /></div>);
  const surface = screen.getByRole('group', { name: 'Voice recording' });
  expect(surface.parentElement).toBe(document.body);
  const check = () => {
    expect(parseFloat(surface.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(surface.style.left) + 268).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(surface.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(surface.style.top) + 108).toBeLessThanOrEqual(window.innerHeight - 8);
  };
  check();
  expect(parseFloat(surface.style.top)).toBe(y === 0 ? 40 : y - 116);
  anchor = { ...anchor, top: 300, bottom: 332 };
  fireEvent.scroll(window);
  expect(parseFloat(surface.style.top)).toBe(184);
  check();
});
