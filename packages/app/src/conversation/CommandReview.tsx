import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { MessageComposer } from './MessageComposer';
import '../desktop/CommandCard.css';

/** Shared spoken-command review. Platform adapters supply their actual account controls. */
export function CommandReview({ title, color, instruction, onChange, onSend, onDismiss, controls, ready, sending, error, notice }: {
  title: string; color?: string; instruction: string; onChange: (value: string) => void;
  onSend: () => void; onDismiss: () => void; controls: ReactNode;
  ready: boolean; sending: boolean; error?: string; notice?: ReactNode;
}) {
  const canSend = ready && !sending && !!instruction.trim();
  return <section className="command-card" aria-label="Command review">
    <div className="command-card-head"><span className="command-card-dot" style={{ background: color || '#888' }} aria-hidden />
      <span>{title}</span><button type="button" aria-label="Cancel command" onClick={onDismiss} disabled={sending}><X size={14}/></button>
    </div>
    <MessageComposer onSend={() => { if (canSend) onSend(); }}
      input={{ 'aria-label': 'Instruction', value: instruction, onValueChange: onChange, disabled: sending, keyboard: 'adaptive' }}
      afterInput={<><div className="command-card-selectors">{controls}</div>{notice}{error && <p role="alert" className="command-card-error">{error}</p>}</>}
      tools={<><button type="submit" disabled={!canSend}>{sending ? 'Sending…' : 'Send'}</button><p className="command-card-hint">Say "go" to send, "cancel" to dismiss</p></>}
      toolsClassName="command-card-actions" />
  </section>;
}
