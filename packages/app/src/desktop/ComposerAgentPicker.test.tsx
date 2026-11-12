import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ComposerAgentPicker } from './ComposerAgentPicker';
import type { AgentSelection, Model } from './agent-selection';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const options = [{ id: 'b', label: 'Codex · Personal', provider: 'codex' }, { id: 'a', label: 'Claude · Work', provider: 'claude', color: '#ffaa44' }, { id: 'g', label: 'Gemini · Home', provider: 'gemini' }];
const narrow = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
function Harness({ initial, save = vi.fn(), start = 'a' }: { initial?: AgentSelection; save?: (v: AgentSelection) => void; start?: string }) {
  const [value, setValue] = useState<AgentSelection>(initial ?? { agent: start, model: 'freddai-level:normal', effort: 'default' });
  return <ComposerAgentPicker options={options} agent={value.agent!} provider={options.find(o => o.id === value.agent)?.provider} native={false} value={value} onChange={v => { setValue(v); save(v); }} onAgentChange={agent => setValue({ agent, model: 'freddai-level:normal', effort: 'default' })}/>;
}
const open = () => { fireEvent.click(screen.getByLabelText('Assistant and difficulty')); return screen.getByRole('dialog'); };
const noTextInputs = (dialog: HTMLElement) => { expect(dialog.querySelector('input')).toBeNull(); expect(screen.queryByLabelText('Custom model ID')).toBeNull(); };

it('wide: shows assistant, model and thinking at once; Fable then High yields a concrete selection and summary', () => {
  const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  for (const name of ['Assistant', 'Model', 'Thinking']) expect(within(dialog).getByRole('group', { name })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Smart' }).textContent).toContain('Fable');
  expect(within(dialog).getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fable' }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'default' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'High' }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'high' });
  expect(screen.getByTestId('composer-agent-summary').textContent).toBe('Claude · Fable · High thinking');
  expect(screen.getByLabelText('Assistant and difficulty').textContent).toContain('Fable · High');
  expect(within(dialog).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true' && ['Smart', 'Normal', 'Fast', 'Opus', 'Sonnet', 'Haiku', 'Fable'].includes(b.getAttribute('aria-label') || b.textContent || '')).length).toBe(1);
  noTextInputs(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('wide: clicking High on the Normal preset converts it to the concrete family', () => {
  const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  expect(screen.getByTestId('composer-agent-summary').textContent).toBe('Claude · Opus (Normal) · Default thinking');
  fireEvent.click(within(dialog).getByRole('button', { name: 'High' }));
  expect(save).toHaveBeenCalledWith({ agent: 'a', model: 'opus', effort: 'high' });
});
it('wide: switching assistant stays on the same view and Codex presets show the mapped effort', () => {
  render(<Harness/>);
  const dialog = open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Codex · Personal' }));
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByRole('button', { name: 'Smart' }).textContent).toContain('Astra · Medium');
  expect(screen.getByTestId('composer-agent-summary').textContent).toBe('Codex · Sol (Normal) · Medium thinking');
});
it('wide: a provider without models has no concrete models and no thinking buttons', () => {
  render(<Harness start="g"/>);
  const dialog = open();
  expect(within(dialog).getByRole('group', { name: 'Model' }).querySelectorAll('button').length).toBe(3);
  expect(within(dialog).queryByRole('button', { name: 'Opus' })).toBeNull();
  expect(within(dialog).getByText(/Not configurable for Gemini/)).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Smart' }).textContent).toContain('Provider default');
});
it('narrow: groups assistants and advances to difficulty, saving the new assistant before closing', () => {
  narrow(); const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  expect(within(dialog).getAllByRole('heading', { level: 3 }).map(e => e.textContent)).toEqual(['Claude Code', 'Codex', 'Gemini CLI (legacy)']);
  const claudeName = within(screen.getByRole('button', { name: 'Claude · Work' })).getByText('Claude · Work');
  expect(claudeName.style.color).toBe('rgb(255, 170, 68)');
  fireEvent.click(screen.getByRole('button', { name: 'Codex · Personal' }));
  expect(screen.getByRole('dialog').textContent).toContain('Step 2 of 2 · Codex · Personal');
  fireEvent.click(screen.getByRole('button', { name: 'Fast' }));
  expect(save).toHaveBeenCalledWith({ agent: 'b', model: 'freddai-level:fast', effort: 'default' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('narrow: Custom goes difficulty, model, thinking with taps only', () => {
  narrow(); const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  fireEvent.click(screen.getByRole('button', { name: 'Claude · Work' }));
  fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
  expect(dialog.textContent).toContain('Step 3 of 5');
  noTextInputs(dialog);
  fireEvent.click(screen.getByRole('button', { name: 'Fable' }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'default' });
  expect(dialog.textContent).toContain('Step 4 of 5');
  noTextInputs(dialog);
  fireEvent.click(screen.getByRole('button', { name: 'High' }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'high' });
  fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('narrow: a provider without models has no Custom step', () => {
  narrow(); render(<Harness start="g"/>);
  open(); fireEvent.click(screen.getByRole('button', { name: 'Gemini · Home' }));
  expect(screen.queryByRole('button', { name: /Custom/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Smart' })).toBeTruthy();
});
it('can choose the current assistant, go back, or cancel without a difficulty change', () => {
  narrow(); const onChange = vi.fn(), onAgentChange = vi.fn();
  render(<ComposerAgentPicker options={options} agent="a" provider="claude" native={false} value={{ model: '', effort: 'default' }} onChange={onChange} onAgentChange={onAgentChange}/>);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Claude · Work' }));
  fireEvent.click(screen.getByRole('button', { name: /Back to assistants/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onChange).not.toHaveBeenCalled(); expect(onAgentChange).not.toHaveBeenCalled();
});
it('does not open while disabled', () => {
  render(<ComposerAgentPicker options={options} agent="a" provider="claude" native={false} value={{ model: '', effort: 'default' }} onChange={vi.fn()} onAgentChange={vi.fn()} disabled/>);
  fireEvent.click(screen.getByLabelText('Assistant and difficulty'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

const speedGroup = (dialog: HTMLElement) => within(dialog).queryByRole('group', { name: 'Speed' });
it('wide: Fable shows a Speed group; Fast mode sets speed and extends the summary', () => {
  const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fable' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'High' }));
  const group = speedGroup(dialog)!;
  expect(within(group).getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true');
  expect(group.textContent).toContain('Opus and Fable only');
  fireEvent.click(within(group).getByRole('button', { name: /Fast mode/ }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'high', speed: 'fast' });
  expect(screen.getByTestId('composer-agent-summary').textContent).toBe('Claude · Fable · High thinking · Fast mode');
  expect(screen.getByLabelText('Assistant and difficulty').textContent).toContain('Fable · High · Fast');
  fireEvent.click(within(speedGroup(dialog)!).getByRole('button', { name: 'Standard' }));
  expect(save.mock.lastCall![0].speed).toBeUndefined();
});
it('wide: choosing Sonnet hides Speed and drops a fast selection', () => {
  const save = vi.fn(); render(<Harness initial={{ agent: 'a', model: 'fable', effort: 'default', speed: 'fast' }} save={save}/>);
  const dialog = open();
  expect(speedGroup(dialog)).not.toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sonnet' }));
  expect(save.mock.lastCall![0].speed).toBeUndefined();
  expect(screen.getByTestId('composer-agent-summary').textContent).not.toContain('Fast mode');
});
it('wide: Speed on the Normal preset keeps the preset', () => {
  const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  fireEvent.click(within(speedGroup(dialog)!).getByRole('button', { name: /Fast mode/ }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'freddai-level:normal', effort: 'default', speed: 'fast' });
  expect(within(dialog).getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('true');
});
it('wide: Codex shows Speed only when the catalog model has a priority service tier', async () => {
  const tier = { id: 'priority', name: 'Fast', description: '2x speed, increased usage' };
  const base = { supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] };
  const withTier: Model[] = [{ model: 'gpt-x', displayName: 'GPT X', isDefault: true, ...base, serviceTiers: [tier] }];
  const without: Model[] = [{ model: 'gpt-x', displayName: 'GPT X', isDefault: true, ...base }];
  const mount = (models: Model[]) => render(<ComposerAgentPicker options={options} agent="b" provider="codex" native value={{ agent: 'b', model: 'gpt-x', effort: 'default' }} onChange={vi.fn()} onAgentChange={vi.fn()} loadModels={async () => models}/>);
  mount(withTier);
  let dialog = open();
  const group = await within(dialog).findByRole('group', { name: 'Speed' });
  expect(group.textContent).toContain('Fast mode');
  expect(group.textContent).toContain('2x speed, increased usage');
  cleanup(); mount(without);
  dialog = open();
  await within(dialog).findByRole('button', { name: 'GPT X' });
});
it('narrow: Custom, Fable, High then a Speed step', () => {
  narrow(); const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  fireEvent.click(screen.getByRole('button', { name: 'Claude · Work' }));
  fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
  expect(dialog.textContent).toContain('Step 3 of 5');
  fireEvent.click(screen.getByRole('button', { name: 'Fable' }));
  fireEvent.click(screen.getByRole('button', { name: 'High' }));
  expect(screen.getByRole('dialog').textContent).toContain('Step 5 of 5');
  fireEvent.click(screen.getByRole('button', { name: /Fast mode/ }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'fable', effort: 'high', speed: 'fast' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('narrow: Sonnet skips the Speed step', () => {
  narrow(); render(<Harness/>);
  open(); fireEvent.click(screen.getByRole('button', { name: 'Claude · Work' }));
  fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Sonnet' }));
  fireEvent.click(screen.getByRole('button', { name: 'High' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('selects Ultracode from the Claude thinking column', () => {
  const save = vi.fn(); render(<Harness save={save}/>);
  const dialog = open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ultracode (Extra high + workflows)' }));
  expect(save).toHaveBeenLastCalledWith({ agent: 'a', model: 'opus', effort: 'ultracode' });
});
