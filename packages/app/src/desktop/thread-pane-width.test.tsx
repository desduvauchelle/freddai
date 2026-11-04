import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDefaultLayout } from '@freddai/ui/components/resizable';

const useThreadLayout = () => useDefaultLayout({ id: 'freddai.thread-panes', onlySaveAfterUserInteractions: true });
afterEach(() => { cleanup(); localStorage.clear(); });

it('restores the user width after remount and ignores automatic pane/window changes', () => {
  const first = renderHook(useThreadLayout);
  const chosen = { 'thread-list': 34, 'thread-detail': 66 };
  act(() => first.result.current.onLayoutChanged(chosen, { isUserInteraction: true }));
  first.unmount();
  const reopened = renderHook(useThreadLayout);
  expect(reopened.result.current.defaultLayout).toEqual(chosen);
  act(() => reopened.result.current.onLayoutChanged({ 'thread-list': 100 }, { isUserInteraction: false }));
  act(() => reopened.result.current.onLayoutChanged({ 'thread-list': 42, 'thread-detail': 58 }, { isUserInteraction: false }));
  reopened.unmount();
  const nextThread = renderHook(useThreadLayout);
  expect(nextThread.result.current.defaultLayout).toEqual(chosen);
});
