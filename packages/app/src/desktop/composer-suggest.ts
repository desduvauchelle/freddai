import Fuse from "fuse.js";

export type SlashCommand = { name: string; description: string; argumentHint: string; source: string };
export type Trigger = { kind: "slash" | "file"; query: string; start: number; end: number };
export type FileItem = { path: string; base: string };

export const MAX_RESULTS = 50;

/** "/" only counts at the very start of the prompt; "@" anywhere at a word start. The caret must be inside the token. */
export function detectTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const slash = /^(\s*)\/([^\s]*)$/.exec(before);
  if (slash) return { kind: "slash", query: slash[2], start: slash[1].length, end: caret };
  const file = /(?:^|\s)@([^\s]*)$/.exec(before);
  if (file) return { kind: "file", query: file[1], start: caret - file[1].length - 1, end: caret };
  return null;
}

export function rankCommands(items: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return items.slice(0, MAX_RESULTS);
  const fuse = new Fuse(items, { keys: [{ name: "name", weight: 2 }, { name: "description", weight: 1 }], threshold: 0.35, ignoreLocation: true });
  return fuse.search(query, { limit: MAX_RESULTS }).map(r => r.item);
}

export function toFileItems(paths: string[]): FileItem[] {
  return paths.map(path => ({ path, base: path.slice(path.lastIndexOf("/") + 1) }));
}
export function fileIndex(items: FileItem[]): Fuse<FileItem> {
  return new Fuse(items, { keys: [{ name: "base", weight: 2 }, { name: "path", weight: 1 }], threshold: 0.35, ignoreLocation: true });
}
export function rankFiles(items: FileItem[], index: Fuse<FileItem>, query: string): FileItem[] {
  if (!query) return items.slice(0, MAX_RESULTS);
  return index.search(query, { limit: MAX_RESULTS }).map(r => r.item);
}

/** Replace the trigger token with the chosen item; returns the new text and caret. */
export function applySuggestion(value: string, trigger: Trigger, insert: string): { value: string; caret: number } {
  const after = value.slice(trigger.end);
  const text = `${insert}${after.startsWith(" ") ? "" : " "}`;
  const next = value.slice(0, trigger.start) + text + after;
  return { value: next, caret: trigger.start + text.length + (after.startsWith(" ") ? 1 : 0) };
}

export type MenuKey = "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape";
/** Pure keyboard reducer for the open menu. Returns the new highlight and what to do. */
export function menuKey(key: string, active: number, count: number): { active: number; action: "none" | "select" | "close" } | null {
  if (!count) return null;
  if (key === "ArrowDown") return { active: (active + 1) % count, action: "none" };
  if (key === "ArrowUp") return { active: (active - 1 + count) % count, action: "none" };
  if (key === "Enter" || key === "Tab") return { active, action: "select" };
  if (key === "Escape") return { active, action: "close" };
  return null;
}
