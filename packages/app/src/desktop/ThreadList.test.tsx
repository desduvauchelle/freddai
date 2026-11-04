import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadList } from "./ThreadList";
import type { Session } from "./types";

const thread = (id: string): Session => ({ id, title: id, project: "p", account: "a", status: "done", updated: 1, provider_id: null, messages: [], pending: null, error: null });
const renderRow = (t: Session) => <button>{t.title}</button>;
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("retains the departing row in place, disables it, and removes it after the exit", () => {
  vi.useFakeTimers();
  const a = thread("a"), b = thread("b");
  const view = render(<ThreadList threads={[a, b]} renderRow={renderRow} />);
  view.rerender(<ThreadList threads={[b]} renderRow={renderRow} />);
  const departing = screen.getByText("a").closest(".thread-presence")!;
  expect(departing.hasAttribute("inert")).toBe(true);
  expect(departing.getAttribute("aria-hidden")).toBe("true");
  expect(departing.nextElementSibling?.textContent).toBe("b");
  act(() => vi.advanceTimersByTime(240));
  expect(screen.queryByText("a")).toBeNull();
  expect(screen.getByText("b")).toBeTruthy();
});

it("cancels removal when a departing thread becomes visible again and uses fresh data", () => {
  vi.useFakeTimers();
  const a = thread("a");
  const view = render(<ThreadList threads={[a]} renderRow={renderRow} />);
  view.rerender(<ThreadList threads={[]} renderRow={renderRow} />);
  view.rerender(<ThreadList threads={[{ ...a, title: "New reply" }]} renderRow={renderRow} />);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByText("New reply").closest(".thread-departing")).toBeNull();
});
