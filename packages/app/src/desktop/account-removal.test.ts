import { afterEach, expect, it, vi } from "vitest";
import { removeConnection } from "./account-removal";
const active = "Finish or stop this connection's active turns and sign-in before removing it.";
afterEach(() => vi.useRealTimers());
it("removes idle connections without stopping work or cancelling sign-in", async () => {
  const command = vi.fn().mockResolvedValue(null);
  await removeConnection("a", command);
  expect(command.mock.calls).toEqual([["remove_account", { account: "a" }]]);
});
it("stops only the removed connection's current active work and waits for actual removal", async () => {
  vi.useFakeTimers();
  let removals = 0;
  const command = vi.fn(async (name: string) => {
    if (name === "remove_account" && ++removals < 3) throw active;
    if (name === "snapshot") return { sessions: [
      { id: "running-a", account: "a", status: "running" },
      { id: "waiting-a", account: "a", status: "waiting" },
      { id: "done-a", account: "a", status: "done" },
      { id: "running-b", account: "b", status: "running" },
    ] };
    return null;
  });
  const pending = removeConnection("a", command);
  await vi.runAllTimersAsync();
  await pending;
  expect(command.mock.calls).toEqual([
    ["remove_account", { account: "a" }], ["snapshot", {}], ["cancel_login", { account: "a" }],
    ["stop", { session: "running-a" }], ["stop", { session: "waiting-a" }],
    ["remove_account", { account: "a" }], ["remove_account", { account: "a" }],
  ]);
});
it("does not stop any work for unrelated removal errors", async () => {
  const command = vi.fn().mockRejectedValue("Could not save database");
  await expect(removeConnection("a", command)).rejects.toBe("Could not save database");
  expect(command).toHaveBeenCalledTimes(1);
});
it("handles a thread finishing between the snapshot and stop request", async () => {
  let removals = 0;
  const command = vi.fn(async (name: string) => {
    if (name === "remove_account" && ++removals === 1) throw active;
    if (name === "snapshot") return { sessions: [{ id: "s", account: "a", status: "running" }] };
    if (name === "stop") throw "No active turn";
    return null;
  });
  await expect(removeConnection("a", command)).resolves.toBeUndefined();
  expect(removals).toBe(2);
});
