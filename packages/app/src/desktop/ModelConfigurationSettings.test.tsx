import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelConfigurationSettings } from './ModelConfigurationSettings';
afterEach(cleanup);
it('shows a provider-by-level table and saves the shared configuration', async () => {
  const onSave=vi.fn().mockResolvedValue(undefined);
  render(<ModelConfigurationSettings onSave={onSave}/>);
  expect(screen.getByRole('columnheader',{name:'Smart'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'Normal'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'Fast'})).toBeTruthy();
  const input=screen.getByDisplayValue('astra');
  fireEvent.change(input,{target:{value:'sol'}});
  fireEvent.click(screen.getByRole('button',{name:'Save model configuration'}));
  await waitFor(()=>expect(onSave).toHaveBeenCalledWith(expect.objectContaining({codex:expect.objectContaining({smart:{family:'sol',effort:'medium'}})})));
  expect(await screen.findByRole('status')).toHaveProperty('textContent','Model configuration saved for all devices.');
});
it('retains edits after a failed save and exposes the failure', async () => {
  render(<ModelConfigurationSettings onSave={async()=>{throw new Error('Disconnected');}}/>);
  fireEvent.change(screen.getByDisplayValue('astra'),{target:{value:'luna'}});
  fireEvent.click(screen.getByRole('button',{name:'Save model configuration'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Disconnected');
  expect((screen.getByLabelText('Codex Smart model') as HTMLInputElement).value).toBe('luna');
});
