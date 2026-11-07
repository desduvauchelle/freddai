// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UserMessage } from './UserMessage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('expands an overflowing preview and collapses it without changing its text', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(132);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(110);
  const text = 'One\nTwo\nThree\nFour\nFive\n**Six**';
  render(<UserMessage text={text} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Six').tagName).toBe('STRONG');
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.user-message-preview')?.textContent).toBe(text);
});

it('does not offer expansion when five lines fit', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(110);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(110);
  render(<UserMessage text={'One\nTwo\nThree\nFour\nFive'} />);
  expect(screen.queryByRole('button')).toBeNull();
});
