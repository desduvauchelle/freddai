export const shortcuts = [
  { id: "schedules", keys: "⌘ ⇧ S", name: "Schedules", key: "s", shift: true },
  { id: "scout", keys: "⌘ ⇧ O", name: "Open Scout", key: "o", shift: true },
  { id: "fork", keys: "⌘ ⇧ F", name: "Fork selected conversation", key: "f", shift: true },
  {
    id: "new",
    keys: "⌘ N / ⌘ K",
    name: "New thread",
    key: "n",
    alternate: "k",
  },
  { id: "search", keys: "⌘ F", name: "Search threads", key: "f" },
  { id: "settings", keys: "⌘ ,", name: "Settings", key: "," },
  { id: "accounts", keys: "⌘ ⇧ A", name: "Accounts", key: "a", shift: true },
  { id: "projects", keys: "⌘ ⇧ P", name: "Add project", key: "p", shift: true },
  { id: "home", keys: "⌘ 1", name: "Home", key: "1" },
  { id: "list", keys: "⌘ 2", name: "Focus thread list", key: "2" },
  { id: "composer", keys: "⌘ 3", name: "Focus message composer", key: "3" },
  {
    id: "attention",
    keys: "⌘ ⇧ I",
    name: "Show needs attention",
    key: "i",
    shift: true,
  },
  {
    id: "attach",
    keys: "⌘ ⇧ U",
    name: "Attach files to active composer",
    key: "u",
    shift: true,
  },
  {
    id: "stop",
    keys: "⌘ ⇧ .",
    name: "Stop selected turn",
    key: ".",
    shift: true,
  },
  { id: "split", keys: "⌘ \\", name: "Toggle split view", key: "\\" },
  { id: "terminal", keys: "⌃ `", name: "Toggle terminal panel", key: "`" },
  { id: "help", keys: "⌘ /", name: "Keyboard shortcuts", key: "/" },
] as const;
export const navigation = [
  ["↑ / ↓ · Home / End", "Move focus through visible thread rows"],
  ["Enter / Space", "Open the focused thread or activate a button"],
  ["Enter / ⇧ Enter", "Send message / insert new line in composer"],
  ["⌘ Enter", "Queue message; create thread in new-thread dialog"],
  ["Tab / ⇧ Tab", "Move through controls in either direction"],
  ["Escape", "Close a dialog; otherwise return from conversation to list"],
  ["↑ / ↓ · Enter · Escape", "Navigate, choose, or dismiss a select menu"],
  ["← / →", "Resize focused pane divider"],
];
export function commandFor(e: KeyboardEvent): string | undefined {
  if (e.isComposing || e.repeat || e.altKey || !(e.metaKey || e.ctrlKey))
    return;
  return shortcuts.find(
    (s) =>
      (s.key === (e.code === "Period" ? "." : e.key.toLowerCase()) ||
        ("alternate" in s && s.alternate === e.key.toLowerCase())) &&
      !!("shift" in s && s.shift) === e.shiftKey,
  )?.id;
}
