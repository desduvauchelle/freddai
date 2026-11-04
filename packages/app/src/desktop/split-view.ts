/** Which thread each conversation pane shows. Without `split` only the left pane exists. */
export type SplitView = { split: boolean; left: string; right: string; focus: "left" | "right" };
export type SplitSide = SplitView["focus"];
export type SplitPreference = { split: boolean; right: string };

export const singleView: SplitView = { split: false, left: "", right: "", focus: "left" };

/** Only the split flag and the second pane's thread survive a reload. */
export const restoreSplitView = (saved: Partial<SplitPreference> | null): SplitView =>
  saved?.split ? { split: true, left: "", right: typeof saved.right === "string" ? saved.right : "", focus: "left" } : singleView;
export const splitPreference = (view: SplitView): SplitPreference => ({ split: view.split, right: view.split ? view.right : "" });

export const focusedThread = (view: SplitView) => view[view.focus];
/** The thread shown in the pane that is not focused ("" when not split or empty). */
export const otherThread = (view: SplitView) => view.split ? view[view.focus === "left" ? "right" : "left"] : "";
/** Thread ids currently on screen, in pane order. */
export const openThreads = (view: SplitView) => (view.split ? [view.left, view.right] : [view.left]).filter(Boolean);

/** Open `id` in the focused pane; a thread already open in the other pane just moves focus there. "" empties the focused pane. */
export function selectThread(view: SplitView, id: string): SplitView {
  if (view.split && id && id === otherThread(view)) return { ...view, focus: view.focus === "left" ? "right" : "left" };
  return { ...view, [view.focus]: id };
}
export const focusPane = (view: SplitView, side: SplitSide): SplitView =>
  view.split && view.focus !== side ? { ...view, focus: side } : view;

/** Turn split on (left keeps its thread, the empty right pane gets focus) or off (the focused pane's thread stays). */
export function toggleSplit(view: SplitView): SplitView {
  if (!view.split) return view.left ? { split: true, left: view.left, right: "", focus: "right" } : view;
  return { ...singleView, left: focusedThread(view) };
}
/** Closing either pane leaves split mode; the other pane's thread becomes the single selected thread. */
export function closePane(view: SplitView, side: SplitSide): SplitView {
  if (!view.split) return { ...view, left: "" };
  return { ...singleView, left: view[side === "left" ? "right" : "left"] };
}
