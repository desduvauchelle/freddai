import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UsageFooter } from "./UsageFooter";
import { AccountOverview } from "./AccountOverview";
import { ConversationUsage } from "./ConversationUsage";
import { empty } from "./types";
import { remainingPercent } from "./usage";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
afterEach(cleanup);
const account = { id: "fixture", name: "Work", provider: "codex" as const, color: "blue" };
it("uses remaining capacity consistently for each quota window, footer text and its limiting circle", async () => {
  invoke.mockResolvedValue({ windows: [{ label: "Session", used_percent: 25, resets_at: null }, { label: "Weekly", used_percent: 80, resets_at: null }], checked_at: Date.now(), plan: null });
  const view = render(<><UsageFooter accounts={[account]} native onOpen={() => {}}/><AccountOverview db={{ ...empty, accounts: [account] }} native onManage={() => {}}/></>);
  const session = await screen.findByRole("progressbar", { name: /Session, remaining capacity/ });
  const weekly = await screen.findByRole("progressbar", { name: /Weekly, remaining capacity/ });
  expect(session.getAttribute("aria-valuenow")).toBe("75");
  expect(weekly.getAttribute("aria-valuenow")).toBe("20");
  expect(screen.getByRole("button", { name: /20% left/ })).toBeTruthy();
  expect(view.container.querySelector('.footer-account-button .usage-ring-fill')?.getAttribute("stroke-dasharray")).toBe("20 100");
  expect(screen.getByText("75% left")).toBeTruthy();
});
it("does not describe unknown capacity as empty or exhausted", async () => {
  invoke.mockRejectedValue("Unavailable");
  const view = render(<UsageFooter accounts={[account]} native onOpen={() => {}}/>);
  expect(await screen.findByRole("button", { name: /Usage unavailable/ })).toBeTruthy();
  expect(view.container.querySelector('.usage-ring-fill')).toBeNull();
});
it("draws the context circle as capacity left while preserving token details", () => {
  const view = render(<ConversationUsage usage={{ context_tokens: 250, context_window: 1000, input_tokens: null, cached_input_tokens: null }}/>);
  expect(screen.getByText("Context 75% left")).toBeTruthy();
  expect(view.container.querySelector('.context-fill')?.getAttribute("stroke-dasharray")).toBe("75 100");
});
it("keeps full, exhausted, out-of-range and unknown values distinct", () => {
  expect([0, 100, 125, -10, NaN, Infinity, null, undefined].map(remainingPercent)).toEqual([100, 0, 0, 100, null, null, null, null]);
});
