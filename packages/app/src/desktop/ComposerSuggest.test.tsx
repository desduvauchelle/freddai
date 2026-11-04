import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestTextarea, type SuggestLoader } from "./ComposerSuggest";
import { applySuggestion, detectTrigger, menuKey, rankCommands, rankFiles, fileIndex, toFileItems } from "./composer-suggest";

afterEach(cleanup);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const commands = [
  { name: "compact", description: "Summarize the conversation", argumentHint: "[focus]", source: "builtin" },
  { name: "review", description: "Review a pull request", argumentHint: "", source: "builtin" },
  { name: "team:ship", description: "Ship it", argumentHint: "<env>", source: "user" },
];
const loader = (over: Partial<SuggestLoader> = {}): SuggestLoader => ({
  commands: async () => commands,
  files: async () => ["README.md", "src/app/main.ts", "src/lib/util.ts", "docs/spec.md"],
  ...over,
});
function Harness({ loader: l, onSend = () => {} }: { loader: SuggestLoader; onSend?: () => void }) {
  const [value, setValue] = useState("");
  return <SuggestTextarea aria-label="Prompt" value={value} onValueChange={setValue} context={{ session: "t" }} loader={l}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSend(); } }} />;
}

it("detects slash only at the start and @ at a word start", () => {
  expect(detectTrigger("/com", 4)).toMatchObject({ kind: "slash", query: "com", start: 0 });
  expect(detectTrigger("/compact now", 12)).toBeNull();
  expect(detectTrigger("hello /com", 10)).toBeNull();
  expect(detectTrigger("see @src/ap", 11)).toMatchObject({ kind: "file", query: "src/ap", start: 4 });
  expect(detectTrigger("mail me@x.com", 13)).toBeNull();
});
it("fuzzy ranks commands and files", () => {
  expect(rankCommands(commands, "revew")[0].name).toBe("review");
  expect(rankCommands(commands, "")).toHaveLength(3);
  const items = toFileItems(["README.md", "src/app/main.ts", "src/lib/util.ts"]);
  expect(rankFiles(items, fileIndex(items), "util")[0].path).toBe("src/lib/util.ts");
});
it("applies a suggestion and moves the caret", () => {
  const t = detectTrigger("fix @src/ap please", 11)!;
  expect(applySuggestion("fix @src/ap please", t, "@src/app/main.ts")).toEqual({ value: "fix @src/app/main.ts please", caret: 21 });
  expect(menuKey("ArrowUp", 0, 3)).toEqual({ active: 2, action: "none" });
  expect(menuKey("ArrowDown", 2, 3)).toEqual({ active: 0, action: "none" });
  expect(menuKey("a", 0, 3)).toBeNull();
  expect(menuKey("Enter", 0, 0)).toBeNull();
});

it("opens the slash menu, filters, navigates with arrows and selects with Enter without sending", async () => {
  const onSend = vi.fn();
  render(<Harness loader={loader()} onSend={onSend} />);
  const box = screen.getByRole("textbox", { name: "Prompt" });
  await userEvent.type(box, "/");
  expect(await screen.findAllByRole("option")).toHaveLength(3);
  await userEvent.type(box, "rev");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await userEvent.keyboard("{Enter}");
  expect((box as HTMLTextAreaElement).value).toBe("/review ");
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).toBeNull();
  await userEvent.keyboard("{Enter}");
  expect(onSend).toHaveBeenCalledTimes(1);
});
it("selects with Tab after arrow navigation and closes with Escape", async () => {
  render(<Harness loader={loader()} />);
  const box = screen.getByRole("textbox", { name: "Prompt" });
  await userEvent.type(box, "/");
  await screen.findAllByRole("option");
  await userEvent.keyboard("{ArrowDown}{Tab}");
  expect((box as HTMLTextAreaElement).value).toBe("/review ");
  await userEvent.clear(box);
  await userEvent.type(box, "/");
  await screen.findByRole("listbox");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect((box as HTMLTextAreaElement).value).toBe("/");
});
it("lets Enter send when nothing matches (a pasted path)", async () => {
  const onSend = vi.fn();
  render(<Harness loader={loader()} onSend={onSend} />);
  const box = screen.getByRole("textbox", { name: "Prompt" });
  await userEvent.type(box, "/Users/me/x");
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  await userEvent.keyboard("{Enter}");
  expect(onSend).toHaveBeenCalled();
});
it("inserts an @file mention mid-prompt", async () => {
  render(<Harness loader={loader()} />);
  const box = screen.getByRole("textbox", { name: "Prompt" });
  await userEvent.type(box, "look at @util");
  const option = await screen.findByRole("option", { name: /util\.ts/ });
  expect(option.textContent).toContain("src/lib/util.ts");
  await userEvent.keyboard("{Enter}");
  expect((box as HTMLTextAreaElement).value).toBe("look at @src/lib/util.ts ");
});
it("shows a loud error when the host cannot list commands", async () => {
  render(<Harness loader={loader({ commands: async () => { throw new Error("host down"); } })} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Prompt" }), "/");
  expect((await screen.findByRole("alert")).textContent).toContain("host down");
});
