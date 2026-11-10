import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolActivity } from './ToolActivity';
import { ThreadLinksContext } from './ThreadLinksContext';

describe('tool output memory', () => {
  it('mounts output only while both disclosures are open', async () => {
    const text = 'large tool output '.repeat(10000);
    const { container } = render(<ToolActivity messages={[{ id: 'one', role: 'tool', text }]} />);
    expect(container.querySelector('pre')).toBeNull();
    const group = container.querySelector('details')!;
    group.open = true; fireEvent(group, new Event('toggle'));
    const call = await screen.findByText('Call 1');
    expect(container.querySelector('pre')).toBeNull();
    const detail = call.closest('details')!;
    detail.open = true; fireEvent(detail, new Event('toggle'));
    await waitFor(() => expect(container.querySelector('pre')?.textContent).toBe(text));
    detail.open = false; fireEvent(detail, new Event('toggle'));
    await waitFor(() => expect(container.querySelector('pre')).toBeNull());
    group.open = false; fireEvent(group, new Event('toggle'));
    await waitFor(() => expect(screen.queryByText('Call 1')).toBeNull());
  });
});

describe('sub-agent cards', () => {
  const messages = [
    { id: 'u', role: 'tool', text: JSON.stringify({ type: 'tool_use', id: 't1', name: 'mcp__freddai__freddai_start_task', input: {} }) },
    { id: 'r', role: 'tool', text: JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"thread":"th1"}' }] }) },
  ];
  it('shows a live card outside the collapsed details that opens the thread', () => {
    const openThread = vi.fn();
    render(<ThreadLinksContext.Provider value={{ openThread, threadInfo: () => ({ title: 'Fix login', projectName: 'Web', status: 'running' }) }}><ToolActivity messages={messages} /></ThreadLinksContext.Provider>);
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open thread: Fix login/ }));
    expect(openThread).toHaveBeenCalledWith('th1');
  });
  it('renders a failed card for a start error and nothing extra when held', () => {
    const err = [messages[0], { id: 'r', role: 'tool', text: JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":false,"error":"No such project"}' }) }];
    const { unmount } = render(<ToolActivity messages={err} />);
    expect(screen.getByText('No such project')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    unmount();
    const held = [messages[0], { id: 'r', role: 'tool', text: JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true,"held":true,"proposal_id":"p"}' }) }];
    const { container } = render(<ToolActivity messages={held} />);
    expect(container.querySelector('.thread-card')).toBeNull();
  });
});
