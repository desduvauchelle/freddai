import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DaySummaries, type DaySummariesClient, type DaySummaryState } from "./DaySummaries";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);

const now = new Date(2026, 4, 10, 15, 0); // Sun 10 May 2026, local
const base = (date: string, over: Partial<DaySummaryState> = {}): DaySummaryState => ({ date, summary: null, running: false, error: null, threads: 0, ...over });
const cached = (date: string): DaySummaryState => base(date, { threads: 3, summary: { date, markdown: "## Overall\n- Shipped login fix\n- Open: review pending\n\n## Project A\n- Fixed login", generated_at: new Date(2026, 4, 10, 9, 5).getTime(), provider: "codex", account: "a", model: "default", threads: 3 } });
function fake(states: Record<string, DaySummaryState>, generate?: DaySummariesClient["generate"]): DaySummariesClient {
  return { get: vi.fn(async d => states[d] ?? base(d)), generate: generate ?? vi.fn(async d => states[d]) };
}
const section = (label: string) => screen.getByRole("button", { name: new RegExp("^" + label) }).closest("section") as HTMLElement;

it("renders the three days and a cached summary with its provenance and no automatic generation", async () => {
  const client = fake({ "2026-05-10": cached("2026-05-10") });
  render(<DaySummaries client={client} now={now}/>);
  expect(await screen.findByText("Fixed login")).toBeTruthy();
  expect(screen.getByText("generated 09:05 by codex")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Today.*3 threads/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Yesterday/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Saturday|Friday|Sunday|Monday|Tuesday|Wednesday|Thursday/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh summary for Today" })).toBeTruthy();
  expect(client.generate).not.toHaveBeenCalled();
});

it("generates on click and shows the returned summary", async () => {
  const states: Record<string, DaySummaryState> = { "2026-05-09": base("2026-05-09", { threads: 2 }) };
  const generate = vi.fn(async (d: string) => cached(d));
  render(<DaySummaries client={fake(states, generate)} now={now}/>);
  await userEvent.click(await screen.findByRole("button", { name: "Generate summary for Yesterday" }));
  expect(generate).toHaveBeenCalledWith("2026-05-09", false);
  await userEvent.click(screen.getByRole("button", { name: /^Yesterday/ }));
  await waitFor(() => expect(within(section("Yesterday")).getByText("Fixed login")).toBeTruthy());
});

it("shows the provider failure reason, not a silent empty state", async () => {
  const generate = vi.fn(async () => { throw new Error("codex request failed: auth expired"); });
  render(<DaySummaries client={fake({ "2026-05-10": base("2026-05-10", { threads: 1 }) }, generate)} now={now}/>);
  await userEvent.click(await screen.findByRole("button", { name: "Generate summary for Today" }));
  expect((await screen.findByRole("alert")).textContent).toContain("codex request failed: auth expired");
});

it("explains an outdated background host instead of a generic failure", async () => {
  const get = vi.fn(async () => { throw new Error("Unknown host command: day_summary"); });
  render(<DaySummaries client={{ get, generate: vi.fn() }} now={now}/>);
  const alerts = await screen.findAllByRole("alert");
  expect(alerts[0].textContent).toContain("background host is older than this app");
  expect(alerts[0].textContent).toContain("Unknown host command: day_summary");
});

it("shows a host-recorded error and marks days without threads as No activity", async () => {
  const err = { code: "provider_failed", reason: "claude request failed: timed out", at: 1 };
  render(<DaySummaries client={fake({ "2026-05-10": base("2026-05-10", { threads: 2, error: err }) })} now={now}/>);
  expect((await screen.findByRole("alert")).textContent).toContain("claude request failed: timed out (provider_failed)");
  await userEvent.click(screen.getByRole("button", { name: /^Yesterday/ }));
  expect(await within(section("Yesterday")).findByText("No activity")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Generate summary for Yesterday" })).toBeNull();
});
