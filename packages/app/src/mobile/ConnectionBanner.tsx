import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { WakeMac } from './WakeMac';
import type { CompanionClient } from './companion';
import { connectionReport, describeConnection, describeHistory, type ConnectionStatus } from './connection-status';

/** A manual check always stays visibly "Checking…" this long, so a fast failure still reads as a response. */
export const MIN_CHECKING_MS = 700;

type Props = {
  status: ConnectionStatus;
  client: CompanionClient;
  /** Starts an immediate check; the banner shows progress from `status.checking`. */
  onTryAgain: () => void;
  /** Present only when this build can re-pair. Called after the user confirms. */
  onPairAgain?: () => void;
  onDismiss: () => void;
  onAwake?: () => void;
  now?: () => number;
};

/** Explains why the Mac is unreachable and what to do; shared by every companion layout (phone styles first). */
export function ConnectionBanner({ status, client, onTryAgain, onPairAgain, onDismiss, onAwake, now = Date.now }: Props) {
  const [, tick] = useState(0), [holding, setHolding] = useState(false), [detailsOpen, setDetailsOpen] = useState(false), [confirming, setConfirming] = useState(false), [copied, setCopied] = useState('');
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { const t = setInterval(() => tick(v => v + 1), 15_000); return () => { clearInterval(t); clearTimeout(hold.current); }; }, []);
  const info = describeConnection(status);
  const busy = status.checking || holding;
  const tryAgain = () => {
    if (busy) return;
    setHolding(true); clearTimeout(hold.current); hold.current = setTimeout(() => setHolding(false), MIN_CHECKING_MS);
    onTryAgain();
  };
  const copy = () => {
    const text = connectionReport(status, now());
    void Promise.resolve(navigator.clipboard?.writeText(text)).then(() => setCopied('Copied'), () => setCopied('Copy failed'));
  };

  if (status.state === 'ok') return <div className="companion-banner" data-state="ok" role="status">
    <div className="companion-banner-body"><strong><Check size={16} aria-hidden /> Connected to your Mac</strong></div>
    <Button variant="ghost" size="icon" className="companion-banner-x" aria-label="Dismiss connection alert" onClick={onDismiss}><X size={18} /></Button>
  </div>;
  if (status.state === 'connecting') return <div className="companion-banner" data-state="connecting" role="status">
    <div className="companion-banner-body"><strong><Loader2 size={16} className="companion-spin" aria-hidden /> Connecting to your Mac…</strong></div>
    <Button variant="ghost" size="icon" className="companion-banner-x" aria-label="Dismiss connection alert" onClick={onDismiss}><X size={18} /></Button>
  </div>;

  const stillDown = status.manualResult === 'failed' && !busy;
  const pairPrimary = info.pair && !!onPairAgain;
  return <div className="companion-banner" data-state="down" data-kind={status.kind ?? 'network'} role="alert">
    <div className="companion-banner-head">
      <div className="companion-banner-body">
        <strong>{info.title}</strong>
        <p className="companion-banner-reason">{info.reason}</p>
        {stillDown && <p className="companion-banner-still" role="status">Still can't reach it — checked just now</p>}
        <small>{describeHistory(status, now())}</small>
      </div>
      <Button variant="ghost" size="icon" className="companion-banner-x" aria-label="Dismiss connection alert" onClick={onDismiss}><X size={18} /></Button>
    </div>
    {status.kind === 'protocol' && <div className="companion-banner-details">
      <button type="button" className="companion-banner-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(v => !v)}>Details <ChevronDown size={16} data-open={detailsOpen} aria-hidden /></button>
      {detailsOpen && <div className="companion-banner-detail-body">
        <code>{info.details || 'The Mac did not include any specifics.'}</code>
        <Button variant="outline" className="companion-banner-copy" onClick={copy}>{copied || 'Copy details'}</Button>
      </div>}
    </div>}
    {confirming ? <div className="companion-banner-confirm" role="group" aria-label="Confirm pairing again">
      <p>Pair this iPhone with your Mac again? Your current pairing stays until the new one succeeds.</p>
      <div className="companion-banner-buttons">
        <Button variant="outline" className="companion-banner-btn" onClick={() => setConfirming(false)}>Cancel</Button>
        <Button className="companion-banner-btn" onClick={() => { setConfirming(false); onPairAgain?.(); }}>Continue</Button>
      </div>
    </div> : <div className="companion-banner-buttons">
      <Button className="companion-banner-btn" variant={pairPrimary ? 'outline' : 'default'} disabled={busy} aria-busy={busy} onClick={tryAgain}>
        {busy ? <><Loader2 size={18} className="companion-spin" aria-hidden /> Checking…</> : 'Try again'}
      </Button>
      {onPairAgain && <Button className="companion-banner-btn" variant={pairPrimary ? 'default' : 'ghost'} onClick={() => setConfirming(true)}>Pair again…</Button>}
    </div>}
    {!confirming && <WakeMac client={client} onAwake={onAwake} />}
  </div>;
}
