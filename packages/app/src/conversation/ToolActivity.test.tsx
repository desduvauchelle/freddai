import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolActivity } from './ToolActivity';

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
