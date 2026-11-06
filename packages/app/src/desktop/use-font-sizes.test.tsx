import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FONT_SIZE_KEY, normalizeFontSizes, useFontSizes } from "./use-font-sizes";
afterEach(() => { cleanup(); localStorage.clear(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
it("validates persisted sizes and clamps the reading range", () => {
  expect(normalizeFontSizes(null)).toEqual({ threads: 12, chat: 14 });
  expect(normalizeFontSizes({ threads: 200, chat: NaN })).toEqual({ threads: 24, chat: 14 });
});
it("prefers hover, falls back to focus, resets, and persists independently", () => {
  document.body.innerHTML = '<div class="thread-browser"><button>Thread</button></div><div class="chat-surface"><textarea></textarea></div>';
  const thread = document.querySelector("button")!;
  const chat = document.querySelector("textarea")!;
  const hit = vi.fn((): Element | null => thread);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  const { result } = renderHook(useFontSizes);
  chat.focus();
  const key = (value: string) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: value, metaKey: true, cancelable: true })); });
  act(() => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20 })); });
  key("+");
  expect(result.current.sizes).toEqual({ threads: 13, chat: 14 });
  hit.mockReturnValue(document.body);
  key("-");
  expect(result.current.sizes).toEqual({ threads: 13, chat: 13 });
  key("0");
  expect(result.current.sizes.chat).toBe(14);
  expect(JSON.parse(localStorage.getItem(FONT_SIZE_KEY)!)).toEqual(result.current.sizes);
  act(() => { result.current.setSize("chat", 24); });
  key("=");
  expect(result.current.sizes.chat).toBe(24);
});
it("leaves unrelated keyboard shortcuts alone", () => {
  renderHook(useFontSizes);
  const event = new KeyboardEvent("keydown", { key: "+", metaKey: true, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
