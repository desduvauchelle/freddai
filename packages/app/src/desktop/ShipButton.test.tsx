import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipButton, SHIP_PROMPT } from "./ShipButton";
import { diffLineKind, shipTooltip, shipVisible, type GitStatusSummary } from "./git-actions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const st = (over: Partial<GitStatusSummary> = {}): GitStatusSummary => ({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, files: 0, ...over });
const mount = (status: GitStatusSummary, onShip = vi.fn(async (_p: string) => {})) => {
  render(<ShipButton projectId="p" projectName="Proj" path="/p" client={{ status: vi.fn(async () => status) }} onShip={onShip} />);
  return onShip;
};
const enabled = () => screen.findByRole("button", { name: /^Commit & push with an agent/ }, { timeout: 4000 });

it("visibility rule: dirty or ahead only", () => {
  expect(shipVisible(null)).toBe(false);
  expect(shipVisible(st())).toBe(false);
  expect(shipVisible(st({ files: 1 }))).toBe(true);
  expect(shipVisible(st({ ahead: 2 }))).toBe(true);
  expect(diffLineKind("+a")).toBe("add");
  expect(diffLineKind("@@ -1 +1 @@")).toBe("hunk");
});

it("tooltip lists only non-zero parts with singular/plural", () => {
  expect(shipTooltip(st({ files: 9, ahead: 10 }))).toBe("Commit & push with an agent · 9 files changed · 10 commits to push");
  expect(shipTooltip(st({ files: 1, ahead: 1 }))).toBe("Commit & push with an agent · 1 file changed · 1 commit to push");
  expect(shipTooltip(st({ files: 3 }))).toBe("Commit & push with an agent · 3 files changed");
  expect(shipTooltip(st({ ahead: 2 }))).toBe("Commit & push with an agent · 2 commits to push");
});

it("title and aria-label carry the counts; the dot shows when there are changes to commit or commits to push", async () => {
  mount(st({ files: 2, ahead: 1 }));
  const b = await enabled();
  expect(b.getAttribute("title")).toBe("Commit & push with an agent · 2 files changed · 1 commit to push");
  expect(b.getAttribute("aria-label")).toBe(b.getAttribute("title"));
  expect(b.querySelector(".ship-dot")).not.toBeNull();
  cleanup();
  mount(st({ files: 2 }));
  expect((await enabled()).querySelector(".ship-dot")).not.toBeNull();
  cleanup();
  mount(st({ ahead: 1 }));
  expect((await enabled()).querySelector(".ship-dot")).not.toBeNull();
});

it("a clean, fully pushed tree is a disabled button and a click is a no-op", async () => {
  const onShip = mount(st());
  const b = await screen.findByRole("button", { name: "Everything is already committed and pushed" }, { timeout: 4000 });
  expect(b.getAttribute("aria-disabled")).toBe("true");
  expect(b.querySelector(".ship-dot")).toBeNull();
  expect(b.getAttribute("title")).toBe("Everything is already committed and pushed");
  await userEvent.click(b);
  expect(onShip).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clicking starts the thread for that project", async () => {
  const onShip = mount(st({ files: 2 }));
  await userEvent.click(await enabled());
  await waitFor(() => expect(onShip).toHaveBeenCalledWith("p"));
  expect(SHIP_PROMPT.split("\n")[0]).toBe("Commit & push");
  expect(SHIP_PROMPT).toContain("without force-pushing");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("a failed launch is shown loudly and logged", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  mount(st({ files: 2 }), vi.fn(async () => { throw new Error("No default account configured for this project."); }));
  await userEvent.click(await enabled());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("No default account configured");
  expect(alert.getAttribute("title")).toContain("No default account configured");
  expect(err).toHaveBeenCalled();
});

it("a git status failure is shown", async () => {
  render(<ShipButton projectId="p" projectName="Proj" path="/p" client={{ status: vi.fn(async () => { throw new Error("fatal: dubious ownership"); }) }} onShip={vi.fn()} />);
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("dubious ownership");
});
