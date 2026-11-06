import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readThreadPins, useThreadPins } from "./thread-pins";
afterEach(() => { cleanup(); localStorage.clear(); });
it("persists pin and unpin choices and updates other consumers without a host", () => {
  const first = renderHook(useThreadPins);
  const other = renderHook(useThreadPins);
  act(() => first.result.current[1]("running-thread", true));
  expect(other.result.current[0]["running-thread"]).toBe(true);
  first.unmount();
  const reopened = renderHook(useThreadPins);
  expect(reopened.result.current[0]["running-thread"]).toBe(true);
  act(() => reopened.result.current[1]("running-thread", false));
  expect(other.result.current[0]["running-thread"]).toBe(false);
});
it("receives changes from other windows and tolerates invalid preferences", () => {
  expect(readThreadPins("broken")).toEqual({});
  expect(readThreadPins('{"a":true,"b":"bad"}')).toEqual({ a: true });
  const hook = renderHook(useThreadPins);
  act(() => {
    localStorage.setItem("freddai.threadPins", '{"other-window":true}');
    window.dispatchEvent(new StorageEvent("storage", { key: "freddai.threadPins" }));
  });
  expect(hook.result.current[0]["other-window"]).toBe(true);
});
