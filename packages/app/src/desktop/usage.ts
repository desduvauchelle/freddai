export type UsageWindow = { label: string; used_percent: number; resets_at: number | null };

export function limitingWindow(windows: UsageWindow[]) {
  return windows.reduce<UsageWindow | undefined>((selected, window) =>
    !selected || window.used_percent > selected.used_percent ? window : selected, undefined);
}

export function resetCountdown(seconds: number | null | undefined, now: number) {
  if (seconds == null || !Number.isFinite(seconds)) return "Reset unavailable";
  const minutes = Math.ceil((seconds * 1000 - now) / 60000);
  if (minutes <= 0) return "Reset due · updating";
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440
    ? `${Math.floor(minutes / 60)}h`
    : `${Math.floor(minutes / 1440)}d`;
  return `${duration} until reset`;
}
