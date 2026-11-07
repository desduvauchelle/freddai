import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Dormouse } from '../desktop/Dormouse';
import { MASCOT_PRIORITY } from '../desktop/mascot-state';

/**
 * Translucent floating header shared by every conversation screen (Commander and regular threads).
 * Native shells draw the menu and action buttons on the same row (transparent bar); this layer draws only the centred
 * avatar, an overlapping name pill and an optional count badge. Chat scrolls behind the blurred fade.
 * Height is `--companion-fh-h` (safe area + ~28px); the transcript is padded by the same variable via `.companion-fh-spacer`.
 */
export function ThreadHeader({ title, mood, mascotLabel, badge = 0, avatarLabel, onAvatar, onBack, error, expanded }: {
  title: string; mood: number; mascotLabel: string; badge?: number; avatarLabel?: string; onAvatar?: () => void; onBack?: () => void; error?: string; expanded?: boolean;
}) {
  const art = <Dormouse size={56} priority={MASCOT_PRIORITY.header + 2} mood={mood} label={mascotLabel} pauseControl={false} />;
  return <header className="companion-fh" aria-label={`${title} header`}>
    {onBack && <button type="button" className="commander-icon-btn companion-fh-back" aria-label="Back to threads" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" /></button>}
    <div className="companion-fh-center">
      <div className="companion-fh-avatar-wrap">
        <span className="companion-fh-avatar" data-needs={badge > 0}><span className="companion-fh-art" aria-hidden="true" {...(onAvatar ? { inert: true as never } : {})}>{art}</span></span>
        {onAvatar && <button type="button" className="companion-fh-open" aria-label={avatarLabel ?? title} aria-haspopup="dialog" aria-expanded={expanded ?? false} onClick={onAvatar} />}
        {badge > 0 && <b className="companion-fh-badge" role="status" aria-label={`${badge} need${badge === 1 ? 's' : ''} you`}>{badge > 9 ? '9+' : badge}</b>}
      </div>
      <span className="companion-fh-pill" title={title}><strong>{title}</strong></span>
    </div>
    {error && <p className="commander-error companion-fh-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
  </header>;
}
