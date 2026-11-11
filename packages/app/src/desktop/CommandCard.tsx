import { X } from 'lucide-react';
import { AgentControls } from './AgentControls';
import { DashboardSelect } from './DashboardSelect';
import type { CommandDraft } from './commandCenter';
import { agentDisplayName, type Account, type Project } from './types';
import './CommandCard.css';

export type CommandSelection = { accountId: string; model: string; effort: string };

/** Review card for a spoken dashboard command: project, editable instruction, agent/model/difficulty, Send and dismiss. */
export function CommandCard({ draft, projects, accounts, native, selection, onChangeSelection, onChangeInstruction, onSend, onDismiss, error, sending = false }: {
  draft: CommandDraft; projects: Project[]; accounts: Account[]; native: boolean; selection: CommandSelection;
  onChangeSelection: (selection: CommandSelection) => void; onChangeInstruction: (text: string) => void;
  onSend: () => void; onDismiss: () => void; error?: string; sending?: boolean;
}) {
  const project = projects.find(p => p.id === draft.projectId);
  const account = accounts.find(a => a.id === selection.accountId);
  return <section className="command-card" aria-label="Command review">
    <div className="command-card-head">
      <span className="command-card-dot" style={{ background: project?.color || '#888' }} aria-hidden />
      <span>{project?.name ?? 'Unknown project'}</span>
      <button type="button" aria-label="Cancel command" title="Cancel" onClick={onDismiss}><X size={14} /></button>
    </div>
    <textarea aria-label="Instruction" value={draft.instruction} onChange={e => onChangeInstruction(e.target.value)} />
    <div className="command-card-selectors">
      <DashboardSelect label="Agent" value={selection.accountId} displayValue={account ? agentDisplayName(account) : 'Choose agent'}
        onChange={id => onChangeSelection({ accountId: id, model: '', effort: 'default' })}
        options={accounts.map(a => ({ value: a.id, label: agentDisplayName(a) }))} />
      <AgentControls inline account={account} native={native} value={{ model: selection.model, effort: selection.effort }}
        onChange={v => onChangeSelection({ accountId: selection.accountId, ...v })} context="this command" />
    </div>
    {error && <p role="alert" className="command-card-error">{error}</p>}
    <div className="command-card-actions">
      <button type="button" disabled={sending || !draft.instruction.trim() || !account} onClick={onSend}>{sending ? 'Sending…' : 'Send'}</button>
      <p className="command-card-hint">Say "go" to send, "cancel" to dismiss</p>
    </div>
  </section>;
}
