import { Button } from '@freddai/ui/components/button';
import { Play, Square } from 'lucide-react';
import './ActivityControls.css';

/** Explicit turn actions, independent of the message composer and its draft. */
export function ActivityControls({ active, interrupted, onStop, onResume, disabled }: {
  active: boolean; interrupted: boolean; onStop?: () => void; onResume?: () => void; disabled?: boolean;
}) {
  if (active && onStop) return <Button type="button" size="icon" variant="ghost" className="activity-control activity-stop" disabled={disabled} onClick={onStop} aria-label="Stop current turn and pause queue" title="Stop current turn and pause queue"><Square size={14} aria-hidden="true" /></Button>;
  if (interrupted && onResume) return <Button type="button" size="sm" variant="default" className="activity-control" disabled={disabled} onClick={onResume}><Play size={14} aria-hidden="true" />Resume</Button>;
  return null;
}
