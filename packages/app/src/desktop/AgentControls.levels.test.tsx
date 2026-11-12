import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentControls } from './AgentControls';
afterEach(cleanup);
it('shows Normal by default and exactly four difficulty choices', async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn(); window.HTMLElement.prototype.hasPointerCapture = vi.fn(); window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  const onChange=vi.fn(); render(<AgentControls provider="claude" native={false} value={{model:'',effort:'default'}} onChange={onChange}/>);
  expect(screen.getByText('Normal', { selector: '.agent-model-label' })).toBeTruthy();
  await userEvent.click(screen.getByRole('combobox',{name:'Agent difficulty'}));
  expect((await screen.findAllByRole('option')).map(e=>e.textContent)).toEqual(['Smart','Normal','Fast','Custom']);
  await userEvent.click(screen.getByRole('option',{name:'Smart'}));
  expect(onChange).toHaveBeenCalledWith({model:'freddai-level:smart',effort:'default'});
  expect(screen.queryByText('Configure model levels')).toBeNull();
});
it('Custom picks the model and effort from lists, never free text', () => {
  const onChange=vi.fn(); render(<AgentControls provider="claude" native={false} value={{model:'opus',effort:'high'}} onChange={onChange}/>);
  expect(screen.queryByLabelText('Custom model ID')).toBeNull();
  expect(document.querySelector('input')).toBeNull();
  fireEvent.change(screen.getByLabelText('Model'),{target:{value:'fable'}});
  expect(onChange).toHaveBeenCalledWith({model:'fable',effort:'high'});
  expect(screen.getByLabelText('Reasoning effort')).toBeTruthy();
});
it('hides Custom when the provider has no concrete models', async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn(); window.HTMLElement.prototype.hasPointerCapture = vi.fn(); window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  render(<AgentControls provider="gemini" native={false} value={{model:'',effort:'default'}} onChange={vi.fn()}/>);
  await userEvent.click(screen.getByRole('combobox',{name:'Agent difficulty'}));
  expect((await screen.findAllByRole('option')).map(e=>e.textContent)).toEqual(['Smart','Normal','Fast']);
});
