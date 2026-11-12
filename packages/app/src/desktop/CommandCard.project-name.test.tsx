import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandCard } from './CommandCard';
import { CompanionCommandCard } from '../mobile/CompanionCommandCard';
vi.mock('./ComposerAgentPicker', () => ({ ComposerAgentPicker: () => null }));
afterEach(cleanup);
it.each(['desktop', 'companion'])('%s review toggles display without changing project or draft', kind => {
  const project = { id: 'p', name: 'Mixed Case', assistants: [], canStart: true };
  const draft = { projectId: 'p', instruction: 'Do work' };
  const props = { draft, projects: [project], accounts: [], native: false, selection: { accountId: '', model: '', effort: '' }, onChangeSelection: vi.fn(), onChangeInstruction: vi.fn(), onSend: vi.fn(), onDismiss: vi.fn(), error: '', sending: false, client: {}, assistant: '', onAssistant: vi.fn(), onSelection: vi.fn() };
  // Minimal fixtures exercise presentation only, never provider calls.
  const Card = (kind === 'desktop' ? CommandCard : CompanionCommandCard) as React.ComponentType<any>;
  const view = render(<Card {...props} />);
  expect(view.container.querySelector('.command-card-head')?.textContent).toBe('Mixed Case');
  view.rerender(<Card {...props} projectNameUppercase />);
  expect(view.container.querySelector('.command-card-head')?.textContent).toBe('MIXED CASE');
  view.rerender(<Card {...props} projectNameUppercase={false} />);
  expect(view.container.querySelector('.command-card-head')?.textContent).toBe('Mixed Case');
  expect(project.name).toBe('Mixed Case');
  expect(draft.projectId).toBe('p');
});
