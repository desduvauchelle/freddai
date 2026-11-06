// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ColorField } from "./ColorField";
afterEach(cleanup);
it("selects colors without opening the native color panel", () => {
  const onChange = vi.fn();
  const { container } = render(<ColorField label="Workspace color" value="#b59ae9" onChange={onChange}/>);
  expect(container.querySelector('input[type="color"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose workspace color' }));
  fireEvent.click(screen.getByRole('button', { name: 'Workspace color: #77b9df' }));
  expect(onChange).toHaveBeenLastCalledWith('#77b9df');
});
it("commits valid hex on blur/Enter and rejects partial or invalid colors", () => {
  const onChange = vi.fn();
  render(<ColorField label="Color" value="#b59ae9" onChange={onChange}/>);
  const input = screen.getByLabelText('Color');
  fireEvent.change(input, { target: { value: '#12' } }); fireEvent.blur(input);
  expect(onChange).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe('#b59ae9');
  fireEvent.change(input, { target: { value: '#AABBCC' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  fireEvent.change(input, { target: { value: '#112233' } }); fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith('#112233');
});
it("closes presets inside a form label after selecting a color", async () => {
  const onChange = vi.fn();
  render(<label>Color<ColorField label="New workspace color" value="#b59ae9" onChange={onChange}/></label>);
  await userEvent.click(screen.getByRole('button', { name: 'Choose new workspace color' }));
  await userEvent.click(screen.getByRole('button', { name: 'New workspace color: #e89cbd' }));
  expect(onChange).toHaveBeenCalledWith('#e89cbd');
  expect(screen.queryByRole('group', { name: 'New workspace color presets' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose new workspace color' }).getAttribute('aria-expanded')).toBe('false');
});
it("closes presets after custom hex is committed and when the same preset is selected", async () => {
  render(<ColorField label="Color" value="#b59ae9" onChange={vi.fn()}/>);
  const trigger = screen.getByRole('button', { name: 'Choose color' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Color: #b59ae9' }));
  expect(screen.queryByRole('group', { name: 'Color presets' })).toBeNull();
  await userEvent.click(trigger);
  const input = screen.getByLabelText('Color');
  fireEvent.change(input, { target: { value: '#112233' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByRole('group', { name: 'Color presets' })).toBeNull();
});
