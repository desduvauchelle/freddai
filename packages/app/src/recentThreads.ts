/** Shared by the desktop sidebar and the mobile companion: a flat, cross-project "Recent" thread view. */
export type ThreadNavView = 'projects' | 'recent';
export const RECENT_INITIAL = 5;
export const RECENT_STEP = 10;
export type RecentPaging = { initial: number; step: number };
/** The companion's bottom "Recent" section page 5, +10. */
export const RECENT_PAGING: RecentPaging = { initial: RECENT_INITIAL, step: RECENT_STEP };
/** Desktop sidebar Recent tab pages 20, +20. */
export const DESKTOP_RECENT_PAGING: RecentPaging = { initial: 20, step: 20 };
/** The companion's dedicated Recent view pages 25, +25. */
export const COMPANION_RECENT_PAGING: RecentPaging = { initial: 25, step: 25 };
export const THREAD_NAV_VIEW_KEY = 'freddai.threadNavView';

export const asThreadNavView = (value: unknown): ThreadNavView => (value === 'recent' ? 'recent' : 'projects');

type RecentCandidate = {
  id: string; updated: number; last_user_message_at?: number | null;
  archived?: boolean; status: string; deleted_at?: number | null;
};

/** Same activity key as `compareThreadRecency`: the last user send, falling back to `updated`. */
const activity = (t: RecentCandidate) => t.last_user_message_at ?? t.updated;

/** How many rows are shown after `pages` "Show more" clicks: 5, 15, 25, … by default */
export const recentLimit = (pages: number, paging: RecentPaging = RECENT_PAGING) => paging.initial + paging.step * Math.max(0, Math.floor(pages) || 0);

/**
 * Newest-first threads across all projects, minus archived and deleted ones.
 * `remaining` is how many more rows exist beyond the current page; `expanded` means "Show less" applies.
 */
export function selectRecentThreads<T extends RecentCandidate>(threads: readonly T[], pages = 0, paging: RecentPaging = RECENT_PAGING) {
  const live = threads
    .filter(t => t.deleted_at == null && !t.archived && t.status !== 'archived' && t.status !== 'deleted')
    .sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
  const shown = live.slice(0, recentLimit(pages, paging));
  return { threads: shown, total: live.length, remaining: live.length - shown.length, expanded: pages > 0 };
}
