import type { ReactNode } from "react";

/** A full ring means all capacity remains. Unknown is a track without a numeric value. */
export function UsageRing({ remaining, color, stale = false, size = 26, label, children }: {
  remaining: number | null; color: string; stale?: boolean; size?: number; label?: string; children?: ReactNode;
}) {
  return <span className="usage-ring" style={{ width: size, height: size }}
    role={label ? "progressbar" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined}
    aria-valuenow={label && remaining !== null ? remaining : undefined}
    aria-valuetext={label ? remaining === null ? "Remaining capacity unavailable" : `${Math.round(remaining)}% left` : undefined}>
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15" className="usage-ring-track"/>
      {remaining !== null && remaining > 0 && <circle cx="18" cy="18" r="15" className="usage-ring-fill" pathLength="100"
        stroke={remaining <= 10 ? "#e9b667" : color} strokeDasharray={`${remaining} 100`} opacity={stale ? .45 : 1}/>}
    </svg>
    {children}
  </span>;
}
