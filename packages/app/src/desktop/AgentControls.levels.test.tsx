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
it('Custom exposes the exact model and effort for the session', () => {
  const onChange=vi.fn(); render(<AgentControls provider="codex" native={false} value={{model:'gpt-specific',effort:'high'}} onChange={onChange}/>);
  expect(screen.getByLabelText('Custom model ID')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Custom model ID'),{target:{value:'gpt-other'}});
  expect(onChange).toHaveBeenCalledWith({model:'gpt-other',effort:'high'});
  expect(screen.getByLabelText('Reasoning effort')).toBeTruthy();
});
