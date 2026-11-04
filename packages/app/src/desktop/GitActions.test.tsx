import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitFileActions } from "./GitActions";
import type { GitClient } from "./git-actions";
import type { GitChange } from "./git-history";

afterEach(cleanup);
const change: GitChange = { path: "src/a.ts", orig_path: null, group: "unstaged", status: "modified", code: "M" };

it("requires confirmation before discarding and shows the diff", async () => {
  const c = { discard: vi.fn(async () => {}), diffFile: vi.fn(async () => "@@ -1 +1 @@\n-old\n+new\n"), stage: vi.fn(async () => {}) } as unknown as GitClient;
  const changed = vi.fn();
  const { rerender } = render(<GitFileActions client={c} path="/p" change={change} diffOpen={false} onToggleDiff={() => {}} onChanged={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Discard src/a.ts" }));
  expect(c.discard).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(c.discard).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Discard src/a.ts" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm discard src/a.ts" }));
  await waitFor(() => expect(c.discard).toHaveBeenCalledWith("/p", change));
  rerender(<GitFileActions client={c} path="/p" change={change} diffOpen onToggleDiff={() => {}} onChanged={changed} />);
  expect((await screen.findByLabelText("Diff of src/a.ts")).textContent).toContain("+new");
});

it("shows git's stderr when an action fails", async () => {
  const c = { stage: vi.fn(async () => { throw new Error("fatal: pathspec 'src/a.ts' did not match any files"); }) } as unknown as GitClient;
  render(<GitFileActions client={c} path="/p" change={change} diffOpen={false} onToggleDiff={() => {}} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Stage src/a.ts" }));
  expect((await screen.findByRole("alert")).textContent).toContain("did not match any files");
});
