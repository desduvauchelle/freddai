import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(keyboard: 'desktop' | 'adaptive' = 'desktop', coarse = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
  const send = vi.fn(), change = vi.fn();
  render(<MessageComposer input={{ 'aria-label': 'Message', value: 'draft', onValueChange: change, keyboard }} onSend={send} tools={<button type="submit">Send</button>} />);
  return { send, change, input: screen.getByRole('textbox') };
}
it('shares submission between keyboard and send button, including steer', () => {
  const { send, input } = setup();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(send.mock.calls).toEqual([[false], [true], [false]]);
});
it.each([{ shiftKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }])('keeps newline/IME input out of the send path: %j', flags => {
  const { send, input } = setup(); fireEvent.keyDown(input, { key: 'Enter', ...flags }); expect(send).not.toHaveBeenCalled();
});
it('preserves soft Return on companion while allowing modified Enter', () => {
  const { send, input } = setup('adaptive', true);
  fireEvent.keyDown(input, { key: 'Enter' }); expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }); expect(send).toHaveBeenCalledWith(true);
});
it('uses desktop Enter on a companion with a hardware pointer', () => {
  const { send, input } = setup('adaptive'); fireEvent.keyDown(input, { key: 'Enter' }); expect(send).toHaveBeenCalledWith(false);
});
